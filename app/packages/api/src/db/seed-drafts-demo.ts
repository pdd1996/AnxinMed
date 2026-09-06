/**
 * M2-T7 确认页演示草稿 seed —— 跑**真管线**产出 pending 草稿，供浏览器逐条自验确认页分支（PRD §10.2）。
 *
 * 为什么跑真管线而不是手写 payload：intake.service → pipeline/run.ts 会真的做 L0 裁剪 / L1 闭合白名单 /
 * L2 脱敏 / 回链校验 / 对**真 drug_master** 做三项严格匹配 / 规则引擎检查 —— 确认页看到的一切都是真产物，
 * 手写 JSON 会把契约漂移藏起来。只有模型 I/O 被本地伪造（合成处方笺，不调真实模型、不花钱、可复现）。
 *
 * 六个场景对齐 PRD §16.1 golden case（T10 E2E 可直接复用这套注入方式）：
 *   ① rx-normal         唯一匹配 + 全字段抄录（1 滴 × 4 次/日 × 7 天）+ 诊断建议 + 范围校验 pass + 相互作用命中
 *   ② rx-spec-conflict  规格冲突 → 冲突清单，系统不选边
 *   ③ rx-redacted       用法行 + 处方日期缺失（兜底返回幻觉值被回链拦截）→ 人工补，绝不预填
 *   ④ drug-box-labeled  入口B 药盒 + 医院标签层 → labelNotice，结构上无用法用量
 *   ⑤ rx-ocr-down       OCR 不可用 → 降级草稿（全字段人工补）
 *   ⑥ rx-over-max       每日 12 次 > 说明书上限 → 范围校验 exceed（仅标注不阻止）
 *
 * 另写一份「已在服」演示基线（demo-drug-levo + demo-plan-levo，drug_master 关联 + active 计划）：
 * 否则 p-001 的生效集合里只有手动建档药（drugMasterId=null），相互作用检查永远命中不了，确认页那块区域无从自验。
 *
 * 幂等：产出的草稿在 payload 打 demoSeed='M2-T7' 标记，基线用 demo- 前缀固定 id；重跑先删自己写的旧行，
 * 绝不碰用户真实草稿/药品。仅 dev 库使用（CLI：pnpm db:seed-drafts）。
 */
import 'dotenv/config'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { todayStr, type LayerLabel } from '@anxin/shared'
import { db, client } from './client.js'
import { drafts, drugs, plans, records, sources } from './schema.js'
import {
  AIUnavailableError,
  type AiClients,
  type FallbackFields,
  type IdentityFields,
  type ImageInput,
  type OcrChar,
  type OcrResult,
} from '../lib/ai/types.js'
import { intakeDrug, intakePrescription } from '../services/intake.service.js'
import * as assetsRepo from '../repositories/assets.repo.js'

const USER = 'p-001'
const MARK = 'M2-T7'
const WEB_BASE = 'http://localhost:5173/drafts'
/** 演示基线（「已在服」的库关联药 + active 计划）固定 id，重跑先删。 */
const BASE = { src: 'demo-src-levo', drug: 'demo-drug-levo', plan: 'demo-plan-levo' }
/** 假图（伪造客户端不解析像素，只需通过 ImageInput 形状）。 */
const IMG: ImageInput = { base64: 'QUJD', mime: 'image/png' }
const HOSPITAL = '萧山区第二人民医院（演示合成处方笺）'
/** parseDrugLine 认得的剂型词（挑演示药品时用，保证条目能被解析出来）。 */
const FORM_RE =
  /滴眼液|滴眼|注射液|注射用|口服液|口服|片|胶囊|颗粒|丸|栓|膏|贴|喷|吸入|混悬|散|糖浆|合剂|滴丸|缓释|分散/

/** 把多行文本渲染成字符级 OCR 结果（布局约定同 __tests__/helpers/ai-mocks.ts：行高 30、字符宽 16 高 20）。 */
function mkOcr(lines: string[], confidence = 0.99, weakLines: number[] = []): OcrResult {
  const chars: OcrChar[] = []
  lines.forEach((line, li) => {
    const y = li * 30
    const conf = weakLines.includes(li) ? 0.82 : confidence
    let x = 10
    for (const ch of line) {
      chars.push({ text: ch, confidence: conf, box: { x, y, w: 16, h: 20 } })
      x += 16
    }
  })
  return { chars }
}

interface FakeOptions {
  layers: LayerLabel[]
  ocr?: OcrResult
  identity?: IdentityFields
  fallback?: FallbackFields
  /** OCR 不可用（降级场景）。 */
  ocrDown?: boolean
  /** 低置信度（确认页标红下划线）。 */
  confidence?: number
}

/** 伪造 AiClients：只冻结模型 I/O，其余（脱敏/回链/匹配/规则）全走真代码。 */
function fakeClients(o: FakeOptions): AiClients {
  return {
    async detectLayers() {
      return o.layers
    },
    async runOcr() {
      if (o.ocrDown) throw new AIUnavailableError('ocr', '演示：OCR 服务不可用')
      return o.ocr ?? { chars: [] }
    },
    async extractIdentity() {
      if (!o.identity) throw new AIUnavailableError('qwen', '演示：VLM 未提供身份')
      return o.identity
    },
    async fallbackParse() {
      return o.fallback ?? {}
    },
  }
}

/** 合成处方笺文本（前记含姓名/电话 —— 用来验证 L0 真的把它们裁掉，payload 里搜不到）。 */
function rxLines(opts: { no: string; name: string; spec: string; sig?: string | null; withDate?: boolean }): string[] {
  const lines = [
    HOSPITAL,
    `处方号：${opts.no}`,
    opts.withDate === false ? '科室：眼科' : `日期：${todayStr()}  科室：眼科`,
    '姓名：张某某 联系电话13800000000',
    '临床诊断：干眼综合征',
    'Rp',
    `${opts.name} ${opts.spec} ×1支`,
  ]
  if (opts.sig !== null) lines.push(`用法：${opts.sig ?? '滴眼 每次1滴 每日4次 共7天'}`)
  lines.push('处方完毕', '医师：（签名）')
  return lines
}

/** 造一个与库值**不重叠**的规格（触发规格冲突）：% 优先，其次质量；都没有则用固定假规格。 */
function bumpSpec(spec: string): string {
  const bump = (n: number) => (n < 1 ? Number((n + 0.2).toFixed(2)) : n * 5)
  if (/%/.test(spec)) return spec.replace(/([\d.]+)%/, (_m, p1: string) => `${bump(Number(p1))}%`)
  const mg = spec.match(/([\d.]+)\s*(mg|毫克|g|克)/i)
  if (mg) return spec.replace(mg[0], `${bump(Number(mg[1]))}${mg[2]}`)
  return '0.3%（10mL：30mg）'
}

/** 说明书 dosage 列是否带结构化用法用量锚点（范围校验要靠它，否则只能出 none）。入参就是 dosage 列本体（{adult:{…}}）。 */
function hasDosageAnchors(dosage: unknown): boolean {
  const adult = (dosage as { adult?: { maxFrequencyPerDay?: unknown; dosePerUse?: unknown } | null } | null)?.adult
  return Boolean(adult && (adult.maxFrequencyPerDay || adult.dosePerUse))
}

/** 演示药品：优先「名字能被 parseDrugLine 认出 + 说明书有结构化上限」（海露 0.1%：1 滴、≤ 10 次/日）。 */
async function pickTarget() {
  const [candidates, inserts] = await Promise.all([
    assetsRepo.listDrugMasterCandidates(),
    assetsRepo.listPackageInsertSlices(),
  ])
  if (candidates.length === 0) return { target: null, candidates, inserts }
  const anchored = new Set(inserts.filter((i) => hasDosageAnchors(i.dosage)).map((i) => i.drugId))
  const withInsert = new Set(inserts.map((i) => i.drugId))
  const pool = candidates.filter((c) => FORM_RE.test(c.genericName))
  const target =
    pool.find((c) => anchored.has(c.id)) ??
    pool.find((c) => withInsert.has(c.id)) ??
    pool[0] ??
    candidates[0]
  return { target, candidates, inserts }
}

/**
 * 演示基线：为 p-001 写一份「已在服」的库关联药 + active 计划（形如一份早前已确认的处方草稿）。
 * 选与目标药有相互作用规则的搭档（海露 → 左氧氟沙星滴眼液，ir-003 需监测），让确认页的相互作用区有真命中。
 * 无规则/无搭档则跳过（不造假规则，PRD §7.8.1：规则库条目只能抄录）。
 */
async function seedBaseline(target: { id: string }, candidates: { id: string; genericName: string; brandName: string | null; specification: string; form: string; manufacturer: string | null }[]) {
  await db.delete(records).where(and(eq(records.userId, USER), eq(records.planId, BASE.plan)))
  await db.delete(plans).where(and(eq(plans.id, BASE.plan), eq(plans.userId, USER)))
  await db.delete(drugs).where(and(eq(drugs.id, BASE.drug), eq(drugs.userId, USER)))
  await db.delete(sources).where(and(eq(sources.id, BASE.src), eq(sources.userId, USER)))

  const rules = await assetsRepo.listInteractionRules()
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const rule = rules.find((r) => ((r.drugIds as string[] | null) ?? []).includes(target.id))
  const partnerId = ((rule?.drugIds as string[] | null) ?? []).find((id) => id !== target.id && byId.has(id))
  if (!rule || !partnerId) {
    console.log('⚠️ 未找到与目标药同规则且已入库的搭档药 —— 跳过演示基线（相互作用区将展示「未命中」状态）')
    return null
  }
  const partner = byId.get(partnerId)!
  const unit = /滴眼|滴鼻|滴耳/.test(partner.form) ? '滴' : '片'
  const now = new Date()

  await db.insert(sources).values({
    id: BASE.src,
    userId: USER,
    type: 'prescription',
    bodyImageRef: null,
    whitelistFields: null,
    prescriptionNo: 'DEMO-RX-BASE',
    confirmTrace: { confirmedAt: now.toISOString(), method: '演示基线（等同于已确认的处方草稿）', keyFieldsSnapshot: {} },
    sanitizeAudit: null,
  })
  await db.insert(drugs).values({
    id: BASE.drug,
    userId: USER,
    genericName: partner.genericName,
    brandName: partner.brandName,
    specification: partner.specification,
    form: partner.form,
    manufacturer: partner.manufacturer,
    drugMasterId: partner.id,
    confirmStatus: 'ocr_matched',
    stock: { value: 1, unit: '支' },
    openedAt: null,
    expiry: null,
    sourceId: BASE.src,
    confirmedAt: now,
  })
  await db.insert(plans).values({
    id: BASE.plan,
    userId: USER,
    drugId: BASE.drug,
    dose: { value: 1, unit },
    frequency: 3,
    times: ['08:00', '14:00', '20:00'],
    route: unit === '滴' ? '滴眼' : '口服',
    meal: null,
    cycleType: 'open',
    startDate: todayStr(),
    endDate: null,
    status: 'active',
    source: 'prescription',
    sourceId: BASE.src,
    itemId: null,
    tags: { dose: 'transcribed', frequency: 'transcribed', times: 'assist', startDate: 'default' },
  })
  console.log(`💊 演示基线：${partner.genericName}（${partner.id}）+ active 计划 —— 与目标药构成规则 ${rule.id}（${rule.level}）`)
  return partner
}

/** 给本次产出的草稿打 demo 标记（幂等删除的依据）。 */
async function markDemo(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(drafts)
    .set({
      payload: sql`${drafts.payload} || ${JSON.stringify({ demoSeed: MARK })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(drafts.userId, USER), inArray(drafts.id, ids)))
}

export async function seedDemoDrafts(): Promise<void> {
  const { target, candidates } = await pickTarget()
  if (!target) {
    throw new Error('drug_master 为空 —— 请先跑 pnpm db:seed（或 db:import-crawled）再 seed 演示草稿')
  }
  const name = target.genericName
  const spec = target.specification
  const identity: IdentityFields = {
    genericName: name,
    brandName: target.brandName ?? undefined,
    specification: spec,
    form: target.form,
    manufacturer: target.manufacturer ?? undefined,
    approvalNumber: target.approvalNumber ?? undefined,
  }
  console.log(`📌 演示药品：${name} ${spec} ${target.form}（drug_master.id=${target.id}）`)

  // 先建「已在服」基线，再跑管线 —— 草稿的相互作用检查才能对到真生效集合
  await seedBaseline(target, candidates)

  // 幂等：只删自己上一轮打过标记的草稿
  const removed = await db
    .delete(drafts)
    .where(and(eq(drafts.userId, USER), sql`${drafts.payload}->>'demoSeed' = ${MARK}`))
    .returning({ id: drafts.id })
  if (removed.length > 0) console.log(`🧹 已清理上一轮演示草稿 ${removed.length} 份`)

  const created: { scene: string; ids: string[] }[] = []

  // ① rx-normal：唯一匹配 + 全字段抄录（用法行故意给低置信度 → 确认页标红下划线）
  const normal = await intakePrescription(
    USER,
    IMG,
    fakeClients({ layers: ['处方层'], ocr: mkOcr(rxLines({ no: 'DEMO-RX-001', name, spec }), 0.99, [7]), identity }),
  )
  created.push({ scene: 'rx-normal 唯一匹配·全字段抄录', ids: normal.draftIds })

  // ② rx-spec-conflict：规格与库不一致 → 冲突清单（系统不选边）
  const badSpec = bumpSpec(spec)
  const conflict = await intakePrescription(
    USER,
    IMG,
    fakeClients({
      layers: ['处方层'],
      ocr: mkOcr(rxLines({ no: 'DEMO-RX-002', name, spec: badSpec })),
      identity: { ...identity, specification: badSpec },
    }),
  )
  created.push({ scene: `rx-spec-conflict 规格冲突（${badSpec} vs 库 ${spec}）`, ids: conflict.draftIds })

  // ③ rx-redacted：用法行 + 日期缺失，兜底模型返回幻觉值 → 回链拦截 → 人工补
  const redacted = await intakePrescription(
    USER,
    IMG,
    fakeClients({
      layers: ['处方层'],
      ocr: mkOcr(rxLines({ no: 'DEMO-RX-003', name, spec, sig: null, withDate: false })),
      identity,
      fallback: { 'items[0].usage': '每次2滴 每日5次' }, // 原文无此串 → 必被回链拦截
    }),
  )
  created.push({ scene: 'rx-redacted 用法/日期缺失·回链拦截', ids: redacted.draftIds })

  // ④ drug-box-labeled：入口B 药盒 + 医院标签层 → labelNotice，无用法用量
  const box = await intakeDrug(
    USER,
    IMG,
    fakeClients({ layers: ['医院标签层', '药盒原装层'], identity }),
  )
  created.push({ scene: 'drug-box-labeled 入口B·标签不抄录', ids: box.draftIds })

  // ⑤ rx-ocr-down：OCR 不可用 → 降级草稿（全字段人工补）
  const down = await intakePrescription(
    USER,
    IMG,
    fakeClients({ layers: ['处方层'], ocrDown: true, identity }),
  )
  created.push({ scene: 'rx-ocr-down OCR 不可用·降级', ids: down.draftIds })

  // ⑥ rx-over-max：每日 12 次 > 说明书上限 → 范围校验 exceed（仅标注不阻止）
  const over = await intakePrescription(
    USER,
    IMG,
    fakeClients({
      layers: ['处方层'],
      ocr: mkOcr(rxLines({ no: 'DEMO-RX-006', name, spec, sig: '滴眼 每次1滴 每日12次 共5天' }), 0.99, [7]),
      identity,
    }),
  )
  created.push({ scene: 'rx-over-max 每日12次·超说明书上限', ids: over.draftIds })

  await markDemo(created.flatMap((c) => c.ids))

  console.log(`\n✅ 演示草稿已就绪（用户 ${USER}，全部 pending）：`)
  for (const c of created) {
    for (const id of c.ids) console.log(`   ${c.scene}\n      ${WEB_BASE}/${id}`)
  }
  console.log('\n提示：原图不入库（服务端只存裁剪几何），确认页会显示「本次会话已无原图」的文字对照降级；')
  console.log('      要看图对照，请走录入页上传（T8）—— 那条路径把原图放进内存会话 store。')
}

// CLI 入口：仅直接运行本文件时对 dev 库执行
if (process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed-drafts-demo.ts')) {
  seedDemoDrafts()
    .then(async () => {
      await client.end()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error('❌ 演示草稿 seed 失败:', err)
      await client.end().catch(() => {})
      process.exit(1)
    })
}
