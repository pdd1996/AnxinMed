/**
 * 爬虫草稿导入 —— data/crawled/*.json → package_inserts（+ 为缺失的 drug 建 crawled 档）
 *
 * 用法：
 *   npm run db:import-crawled                # 导入全部草稿（幂等，可重复运行）
 *   npm run db:import-crawled -- --dry-run   # 只打印将执行的动作（事务内执行后回滚），不落库、不记日志
 *   npm run db:import-crawled -- --status    # 草稿 ↔ 数据库对账：哪些已入库、哪些待入库
 *
 * 语义（PRD §13.3 / .agents/skills/drug-crawler/references/field-mapping.md）：
 * - 草稿以 curationStatus='crawled' 入库（staging）；人工核对（crawled → reviewed）不在本脚本范围，
 *   curationStatus='reviewed' 的文件一律拒绝——其结构化映射（dosage 等）待人工核对流程定稿后另做；
 * - 幂等以（drugId, version）为逻辑键，防重复写：
 *   · 同版本已有 mock / reviewed 行 → 跳过不覆盖（write-once）；
 *   · 同版本已有 crawled 行 → 内容有变化才刷新，否则跳过；
 * - package_inserts 身份组：drug_master 已有行时复制其值（身份快照语义），否则用 dxyTitle 启发式解析；
 * - drug_master：已有行不动；缺失才自动建档（crawled 状态 + 解析备注，待人工核对）；
 * - interaction_rules 永不触碰（条目只能人工抄录，PRD §7.8.1）；
 * - 每次实跑向 data/import-log.jsonl 追加一行/药，记录动作与原因（入库台账）。
 */
import 'dotenv/config'
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, TransactionRollbackError } from 'drizzle-orm'
import { z } from 'zod'
import { db, client } from './client.js'
import { drugMaster, packageInserts } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// app/packages/api/src/db → 上溯 5 级到工作区根目录
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')
const crawledDir = join(repoRoot, 'data', 'crawled')
const importLogPath = join(repoRoot, 'data', 'import-log.jsonl')

// ── 草稿 zod 契约（入库前校验，失败即拒，不静默吞） ──────────────────────────
const CrawledDraftSchema = z
  .object({
    drugId: z.string().regex(/^(mock|drug)-[a-z0-9]+(-[a-z0-9]+)*$/, 'drugId 须为 mock-*/drug-* 小写形式（mock-=绑定 mock-data.json 的既有条目；drug-=2026-09-05 起新草稿，与数据来源解耦）'),
    crawledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'crawledAt 须为 YYYY-MM-DD'),
    curationStatus: z.literal('crawled', {
      errorMap: () => ({ message: "本脚本只导 crawled 草稿；reviewed 文件走人工核对后的专用路径（待建）" }),
    }),
    dxyId: z.string().min(4),
    sourceUrl: z.string().url(),
    dxyTitle: z.string().min(1),
    tags: z.array(z.string()).default([]),
    approvalDate: z.string().nullable().default(null),
    revisionDate: z.string().nullable().default(null),
    version: z.string().regex(/^dxy-\d{4}-\d{2}-\d{2}$/, 'version 须为 dxy-YYYY-MM-DD'),
    searchKeyword: z.string().optional(),
    searchCandidates: z.array(z.string()).optional(),
    matchNote: z.string().default(''),
    sections: z.record(z.string()),
  })
  .refine((d) => Object.keys(d.sections).length > 0, { message: 'sections 不能为空' })
  .refine((d) => (d.sections['规格'] ?? '').trim().length > 0, {
    message: 'sections 缺「规格」段（drug_master.specification / 规格核验依赖）',
  })

type Draft = z.infer<typeof CrawledDraftSchema>

// ── dxyTitle 身份解析（启发式，仅供自动建档初稿，人工核对为准） ────────────────
const FORM_SUFFIXES = [
  '缓释胶囊', '控释胶囊', '肠溶胶囊', '缓释片', '控释片', '肠溶片', '分散片', '咀嚼片', '泡腾片',
  '口服溶液', '口服混悬液', '混悬液', '滴眼液', '滴鼻液', '滴耳液', '注射液', '注射用',
  '乳膏', '软膏', '凝胶', '贴膏', '气雾剂', '喷雾剂', '吸入剂', '胶囊', '颗粒', '滴丸', '片', '丸', '栓', '糖浆',
].sort((a, b) => b.length - a.length)

function formSuffixOf(s: string): string | null {
  return FORM_SUFFIXES.find((f) => s.endsWith(f)) ?? null
}

interface ParsedIdentity {
  genericName: string
  brandName: string | null
  form: string | null
  confident: boolean
}

/**
 * DXY 标题两种语序：「商品名（通用名）」与「通用名（商品名）」。
 * 以剂型后缀判别：带剂型后缀的一侧是通用名（如 布洛芬缓释胶囊（芬必得） vs 泰诺林（对乙酰氨基酚缓释片））。
 */
function parseDxyTitle(title: string): ParsedIdentity {
  const m = title.match(/^([^（]+)（([^）]+)）(.*)$/)
  if (!m) return { genericName: title, brandName: null, form: formSuffixOf(title), confident: false }
  const [, head, inner, tail] = m
  const headForm = formSuffixOf(head)
  const innerForm = formSuffixOf(inner)
  if (headForm && !innerForm) {
    return { genericName: head, brandName: (inner + tail).trim() || null, form: headForm, confident: true }
  }
  if (innerForm && !headForm) {
    return { genericName: inner, brandName: (head + tail).trim() || null, form: innerForm, confident: true }
  }
  return { genericName: title, brandName: null, form: innerForm ?? headForm, confident: false }
}

// ── 草稿 → package_inserts 列映射 ────────────────────────────────────────────
// 遵循 field-mapping.md：text 列直抄；jsonb 列以「整段原文」的显式形态存（dosage={raw}、
// contraindications/precautions=[整段]），结构化/拆分是人工核对步骤，不在导入时伪造。
const MAPPED_COLUMNS = [
  'genericName', 'brandName', 'form', 'specification',
  'indication', 'components', 'dosage', 'contraindications', 'adverseReactions', 'precautions',
  'interactions', 'pharmacology', 'pharmacokinetics', 'storage', 'afterOpeningDays',
  'source', 'version', 'sourceUrl', 'curationNote',
] as const

type MappedColumn = (typeof MAPPED_COLUMNS)[number]

interface MappedInsertValues {
  genericName: string
  brandName: string | null
  form: string | null
  specification: string | null
  indication: string | null
  components: string | null
  dosage: unknown
  contraindications: unknown
  adverseReactions: string | null
  precautions: unknown
  interactions: string | null
  pharmacology: string | null
  pharmacokinetics: string | null
  storage: string | null
  afterOpeningDays: number | null
  source: string | null
  version: string | null
  sourceUrl: string | null
  curationNote: string | null
}

function buildCurationNote(d: Draft): string {
  const notes: string[] = ['【爬虫草稿导入·未人工核对】']
  if (d.sections['用法用量']) notes.push('dosage 存原文（{raw}）待人工结构化（PRD §13.2）')
  if (d.sections['禁忌']) notes.push('禁忌为整段单元素数组，待人工拆分')
  if (d.sections['注意事项']) notes.push('注意事项为整段单元素数组，待人工拆分')
  if (!d.sections['药物相互作用']) notes.push('interactions 网页版缺失，待人工从注意事项/修订公告抄录（禁止模型生成）')
  notes.push('storage/afterOpeningDays 网页版缺失，待人工补')
  notes.push(`DXY 规格段原文「${d.sections['规格'].trim()}」`)
  if (d.matchNote) notes.push(`matchNote：${d.matchNote}`)
  return notes.join('；')
}

function mapDraftToInsertValues(
  d: Draft,
  identity: { genericName: string; brandName: string | null; form: string | null; specification: string | null },
): MappedInsertValues {
  return {
    genericName: identity.genericName,
    brandName: identity.brandName,
    form: identity.form,
    specification: identity.specification,
    indication: d.sections['适应症'] ?? null,
    components: d.sections['成份'] ?? null,
    dosage: d.sections['用法用量'] ? { raw: d.sections['用法用量'] } : null,
    contraindications: d.sections['禁忌'] ? [d.sections['禁忌']] : null,
    adverseReactions: d.sections['不良反应'] ?? null,
    precautions: d.sections['注意事项'] ? [d.sections['注意事项']] : null,
    interactions: d.sections['药物相互作用'] ?? null,
    pharmacology: d.sections['药理作用'] ?? null,
    pharmacokinetics: d.sections['药代动力学'] ?? null,
    storage: null,
    afterOpeningDays: null,
    source: `丁香园用药助手（说明书修改日期 ${d.version.slice('dxy-'.length)}）`,
    version: d.version,
    sourceUrl: d.sourceUrl,
    curationNote: buildCurationNote(d),
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function mappedDiff(values: MappedInsertValues, row: Record<string, unknown>): string[] {
  return MAPPED_COLUMNS.filter((k) => !jsonEqual(values[k as MappedColumn], row[k]))
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
interface DrugMasterLite {
  id: string
  genericName: string
  brandName: string | null
  form: string | null
  specification: string
  curationStatus: string
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const statusOnly = args.includes('--status')

  // 1. 读草稿 + zod 校验
  const files = readdirSync(crawledDir).filter((f) => f.endsWith('.json')).sort()
  if (files.length === 0) {
    console.error(`❌ 未找到草稿：${crawledDir}/*.json`)
    return 1
  }

  const drafts: { file: string; draft: Draft }[] = []
  const errors: string[] = []
  const seenDrugIds = new Set<string>()
  for (const file of files) {
    const path = join(crawledDir, file)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (e) {
      errors.push(`${file}: JSON 解析失败 — ${(e as Error).message}`)
      continue
    }
    const result = CrawledDraftSchema.safeParse(parsed)
    if (!result.success) {
      errors.push(`${file}: 草稿校验失败 — ${result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
      continue
    }
    if (seenDrugIds.has(result.data.drugId)) {
      errors.push(`${file}: drugId ${result.data.drugId} 与其他草稿重复`)
      continue
    }
    seenDrugIds.add(result.data.drugId)
    drafts.push({ file, draft: result.data })
  }

  // 2. 读数据库现状
  const masterRows = await db.select().from(drugMaster)
  const masters = new Map<string, DrugMasterLite>(masterRows.map((r) => [r.id, {
    id: r.id,
    genericName: r.genericName,
    brandName: r.brandName,
    form: r.form,
    specification: r.specification,
    curationStatus: r.curationStatus,
  }]))
  const insertRows = await db.select().from(packageInserts)

  if (statusOnly) {
    console.log(`📋 草稿 ↔ 数据库对账（草稿 ${drafts.length} 份，校验失败 ${errors.length} 份）\n`)
    for (const { draft } of drafts) {
      const master = masters.get(draft.drugId)
      const existing = insertRows.find((r) => r.drugId === draft.drugId && r.version === draft.version)
      const masterState = master ? `master=${master.curationStatus}` : 'master=缺失（导入时自动建档）'
      let insertState: string
      if (!existing) insertState = '说明书=未入库'
      else insertState = `说明书=已入库（${existing.curationStatus}，${existing.id}）`
      console.log(`  ${draft.drugId.padEnd(32)} ${draft.version}  ${masterState}  ${insertState}`)
    }
    console.log(`\n   数据库现存：drug_master ${masterRows.length} 行，package_inserts ${insertRows.length} 行`)
    if (errors.length) {
      console.error('\n⚠️ 校验失败的草稿：')
      errors.forEach((e) => console.error(`   ${e}`))
    }
    return errors.length > 0 ? 1 : 0
  }

  console.log(`📥 导入爬虫草稿（${drafts.length} 份，校验失败 ${errors.length} 份）${dryRun ? ' · dry-run' : ''}\n`)

  // 3. 逐药导入（每药一个事务；dry-run 在事务尾回滚）
  const runAt = new Date().toISOString()
  const results: { draft: Draft; insert: string; master: string; reason?: string }[] = []

  for (const { draft } of drafts) {
    const d = draft
    let insertMsg = ''
    let masterMsg = ''
    let reason: string | undefined

    try {
      await db.transaction(async (tx) => {
        // 3a. drug_master：已有不动；缺失自动建档（crawled）
        if (masters.has(d.drugId)) {
          masterMsg = `exists(${masters.get(d.drugId)!.curationStatus})`
        } else {
          const identity = parseDxyTitle(d.dxyTitle)
          if (!identity.form) {
            masterMsg = 'skipped(剂型无法解析，留待人工建档)'
          } else {
            const otcClass = d.tags.find((t) => t === 'OTC甲' || t === 'OTC乙') ?? null
            const insuranceClass = d.tags.find((t) => t === '医保甲类' || t === '医保乙类' || t === '自费') ?? null
            await tx.insert(drugMaster).values({
              id: d.drugId,
              genericName: identity.genericName,
              brandName: identity.brandName,
              specification: d.sections['规格'].trim(),
              form: identity.form,
              manufacturer: d.sections['生产企业']?.trim() ?? null,
              approvalNumber: null,
              otcClass,
              insuranceClass,
              isOriginal: false,
              curationStatus: 'crawled',
              dataSource: `丁香园用药助手 ${d.sourceUrl}`,
              note: `爬虫导入自动建档（原无 drug_master 行）：dxyTitle「${d.dxyTitle}」身份字段为标题启发式解析（${identity.confident ? '语序判定' : '兜底整题'}），待人工核对；未入 mock 清单条目去留见总账`,
            })
            masters.set(d.drugId, {
              id: d.drugId, genericName: identity.genericName, brandName: identity.brandName,
              form: identity.form, specification: d.sections['规格'].trim(), curationStatus: 'crawled',
            })
            masterMsg = 'created'
          }
        }

        // 3b. package_inserts：以（drugId, version）幂等
        const master = masters.get(d.drugId)
        const identity = master
          ? { genericName: master.genericName, brandName: master.brandName, form: master.form, specification: master.specification }
          : (() => {
              const p = parseDxyTitle(d.dxyTitle)
              return { genericName: p.genericName, brandName: p.brandName, form: p.form, specification: d.sections['规格'].trim() }
            })()
        const values = mapDraftToInsertValues(d, identity)
        const insertId = `pi-${d.drugId}@${d.version}`
        const existing = insertRows.find((r) => r.drugId === d.drugId && r.version === d.version)

        if (existing && existing.curationStatus !== 'crawled') {
          insertMsg = `skipped`
          reason = `同（drugId, version）已有 ${existing.curationStatus} 行（${existing.id}），write-once 不覆盖`
        } else if (existing) {
          const diff = mappedDiff(values, existing)
          if (diff.length === 0) {
            insertMsg = 'skipped-unchanged'
            reason = `同版本 crawled 行已存在且内容一致（${existing.id}）`
          } else {
            await tx.update(packageInserts)
              .set({ ...values, curationStatus: 'crawled', updatedAt: new Date() })
              .where(eq(packageInserts.id, existing.id))
            insertMsg = `updated(${existing.id})`
            reason = `草稿内容变化，刷新：${diff.join(', ')}`
          }
        } else {
          await tx.insert(packageInserts).values({ id: insertId, drugId: d.drugId, curationStatus: 'crawled', ...values })
          insertMsg = `inserted(${insertId})`
        }

        // dry-run：走完全部 SQL 后回滚，不落库（回滚信号以异常传播，由下方 catch 接住）
        if (dryRun) tx.rollback()
      })
    } catch (err) {
      if (dryRun && err instanceof TransactionRollbackError) {
        // 预期内的 dry-run 回滚信号
      } else {
        errors.push(`${d.drugId}: 数据库写入失败 — ${(err as Error).message}`)
        console.error(`  ${d.drugId.padEnd(32)} ❌ 写入失败：${(err as Error).message}`)
        continue
      }
    }

    // 3c. 入库台账（仅实跑）
    if (!dryRun) {
      appendFileSync(importLogPath, `${JSON.stringify({
        runAt,
        drugId: d.drugId,
        dxyId: d.dxyId,
        version: d.version,
        packageInsert: { action: insertMsg, reason: reason ?? null },
        drugMaster: { action: masterMsg },
      })}\n`)
    }
    results.push({ draft: d, insert: insertMsg, master: masterMsg, reason })
    console.log(`  ${d.drugId.padEnd(32)} insert=${insertMsg}  master=${masterMsg}${reason ? `  ← ${reason}` : ''}`)
  }

  // 4. 汇总
  const inserted = results.filter((r) => r.insert.startsWith('inserted')).length
  const updated = results.filter((r) => r.insert.startsWith('updated')).length
  const skipped = results.filter((r) => r.insert.startsWith('skipped')).length
  const masterCreated = results.filter((r) => r.master === 'created').length

  console.log(`\n${dryRun ? '🔍 dry-run 结果（未落库）' : '✅ 导入完成'}`)
  console.log(`   package_inserts：新增 ${inserted} / 刷新 ${updated} / 跳过 ${skipped}`)
  console.log(`   drug_master：自动建档 ${masterCreated} / 已有不动的 ${results.length - masterCreated}`)
  if (!dryRun) console.log(`   入库台账已追加：${importLogPath}`)
  if (errors.length) {
    console.error(`\n⚠️ ${errors.length} 份草稿校验失败（未导入）：`)
    errors.forEach((e) => console.error(`   ${e}`))
  }
  return errors.length > 0 ? 1 : 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 导入失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
