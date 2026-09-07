/**
 * p-001 演示数据 seed（任务书 T9-2）——只写用户域，绝不触碰资产域。
 * 为演示用户 p-001 生成：4 个手动药 + 4 个 active 计划 + 最近 7 天 records（recordPresets 的 rate/tailSkip 逻辑）
 * + 若干 self_reported 健康信息。保证「注册即见今日任务」，且能触发相互作用冲突提示（见下）。
 *
 * 冲突演示：4 药构成两对能被现有 interaction_rules 命中的组合——
 *   氨氯地平 + 阿托伐他汀（ir-001）、二甲双胍 + 格列吡嗪（ir-002）。
 * 关键：drugs.drugMasterId 必须指向 drug_master 中真实存在的行，否则被 activeMasterIds 过滤排除
 * （检测逻辑见 plans.service.runRuleChecks / insight.service.resolveInteractionsSummary），冲突永不触发。
 * 复用既有规则，不生成任何新的相互作用条目内容（PRD §7.8.1）。
 *
 * 幂等：全部使用 demo- 前缀固定 id；重跑先删 demo- 前缀旧数据再插入，不影响用户自建数据（drug-/plan-/health- 前缀）。
 * 仅 dev 库使用（CLI：pnpm db:seed-demo）；测试库不跑（测试自建数据）。
 */
import 'dotenv/config'
import { inArray, like } from 'drizzle-orm'
import { db as devDb, client } from './client.js'
import { users, drugs, plans, records, healthProfiles, drugMaster, consultLogs, riskEvents } from './schema.js'
import { addDaysStr, todayStr } from '@anxin/shared'

/**
 * drug_master ID 前缀历史遗留（见 oneoff-2026-09-05-rename-legacy-mock-ids.ts）：dev 库已把 mock-*
 * 改名为 drug-*，但 demo/server/mock-data.json（seed.ts 的数据源）仍是 mock-*。为使本 seed 在两种前缀下
 * 都能把 drugMasterId 指向真实存在的 drug_master 行，这里按候选顺序在库中探测实际 id，而不是写死前缀。
 */
const MASTER_ID_CANDIDATES: Record<string, string[]> = {
  amlodipine: ['drug-amlodipine-5', 'mock-amlodipine-5'],
  atorvastatin: ['drug-atorvastatin-20', 'mock-atorvastatin-20'],
  metformin: ['drug-metformin-500', 'mock-metformin-500'],
  glipizide: ['drug-glipizide-5', 'mock-glipizide-5'],
}

/** 在 drug_master 中探测候选 id，返回首个真实存在的（都不存在则 null）。 */
async function resolveMasterId(db: typeof devDb, key: string): Promise<string | null> {
  const candidates = MASTER_ID_CANDIDATES[key]
  const rows = await db.select({ id: drugMaster.id }).from(drugMaster).where(inArray(drugMaster.id, candidates))
  const found = new Set(rows.map((r) => r.id))
  return candidates.find((c) => found.has(c)) ?? null
}

/** 确定性字符串哈希（0..INT），保证 records 生成可复现。 */
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

interface Preset {
  planId: string
  drugId: string
  rate: number // 0..1，历史日打勾概率
  tailSkip: number // 最近 N 天（含今天）不生成记录 → 保持 pending
  times: string[]
}

const PRESETS: Preset[] = [
  { planId: 'demo-plan-amlo', drugId: 'demo-drug-amlo', rate: 0.55, tailSkip: 3, times: ['08:00'] },
  { planId: 'demo-plan-atorva', drugId: 'demo-drug-atorva', rate: 0.6, tailSkip: 2, times: ['20:00'] },
  { planId: 'demo-plan-metf', drugId: 'demo-drug-metf', rate: 0.7, tailSkip: 1, times: ['08:00', '19:00'] },
  { planId: 'demo-plan-glip', drugId: 'demo-drug-glip', rate: 0.65, tailSkip: 2, times: ['07:30', '17:30'] },
]

const HEALTH: { fieldKey: string; value: string }[] = [
  { fieldKey: '性别', value: '男' },
  { fieldKey: '年龄', value: '68' },
  { fieldKey: '诊断', value: '高血压、2型糖尿病' },
]

export async function seedDemoData(db: typeof devDb = devDb): Promise<void> {
  const today = todayStr()
  const now = new Date()

  // 解析 drug_master 中真实存在的 id（前缀兼容 drug-* / mock-*）——相互作用检测的前提
  const [amloMaster, atorvaMaster, metfMaster, glipMaster] = await Promise.all([
    resolveMasterId(db, 'amlodipine'),
    resolveMasterId(db, 'atorvastatin'),
    resolveMasterId(db, 'metformin'),
    resolveMasterId(db, 'glipizide'),
  ])
  if (!amloMaster || !atorvaMaster || !metfMaster || !glipMaster) {
    console.warn(
      '⚠️  drug_master 缺少相互作用规则涉及的条目（amlodipine/atorvastatin/metformin/glipizide），' +
        '冲突演示可能无法触发；请先跑资产 seed / import-crawled。',
    )
  }

  // 演示用户（幂等 upsert）
  await db
    .insert(users)
    .values({ id: 'p-001', name: '张某某', email: null, phone: null })
    .onConflictDoUpdate({ target: users.id, set: { name: '张某某', updatedAt: now } })

  // 清掉旧 demo 数据（仅 demo- 前缀，不影响用户自建数据）
  await db.delete(records).where(like(records.id, 'demo-rec-%'))
  await db.delete(plans).where(like(plans.id, 'demo-plan-%'))
  await db.delete(drugs).where(like(drugs.id, 'demo-drug-%'))
  await db.delete(healthProfiles).where(like(healthProfiles.id, 'demo-health-%'))

  // 药箱 4 个手动药（前两个构成 ir-001，后两个构成 ir-002；drugMasterId 均指向已解析的 drug_master 行）
  await db.insert(drugs).values([
    {
      id: 'demo-drug-amlo',
      userId: 'p-001',
      genericName: '苯磺酸氨氯地平片',
      brandName: '（演示）',
      specification: '5mg',
      form: '片剂',
      manufacturer: '演示药厂',
      drugMasterId: amloMaster,
      confirmStatus: 'manual',
      stock: { value: 30, unit: '片' },
      openedAt: addDaysStr(today, -20),
      expiry: addDaysStr(today, 200),
      confirmedAt: now,
    },
    {
      id: 'demo-drug-atorva',
      userId: 'p-001',
      genericName: '阿托伐他汀钙片',
      brandName: '（演示）',
      specification: '20mg',
      form: '片剂',
      manufacturer: '演示药厂',
      drugMasterId: atorvaMaster,
      confirmStatus: 'manual',
      stock: { value: 28, unit: '片' },
      openedAt: addDaysStr(today, -20),
      expiry: addDaysStr(today, 240),
      confirmedAt: now,
    },
    {
      id: 'demo-drug-metf',
      userId: 'p-001',
      genericName: '盐酸二甲双胍片',
      brandName: '（演示）',
      specification: '0.5g',
      form: '片剂',
      manufacturer: '演示药厂',
      drugMasterId: metfMaster,
      confirmStatus: 'manual',
      stock: { value: 60, unit: '片' },
      openedAt: addDaysStr(today, -20),
      expiry: addDaysStr(today, 150),
      confirmedAt: now,
    },
    {
      id: 'demo-drug-glip',
      userId: 'p-001',
      genericName: '格列吡嗪片',
      brandName: '（演示）',
      specification: '5mg',
      form: '片剂',
      manufacturer: '演示药厂',
      drugMasterId: glipMaster,
      confirmStatus: 'manual',
      stock: { value: 40, unit: '片' },
      openedAt: addDaysStr(today, -15),
      expiry: addDaysStr(today, 180),
      confirmedAt: now,
    },
  ])

  // 4 个 active 计划（startDate 均为近期、endDate 为 null 开放式 → isPlanActiveOn(today) 恒真）
  await db.insert(plans).values([
    {
      id: 'demo-plan-amlo',
      userId: 'p-001',
      drugId: 'demo-drug-amlo',
      dose: { value: 1, unit: '片' },
      frequency: 1,
      times: ['08:00'],
      route: '口服',
      meal: '饭后',
      cycleType: 'open',
      startDate: addDaysStr(today, -30),
      endDate: null,
      status: 'active',
      source: 'manual',
      tags: { dose: 'user', frequency: 'user', times: 'assist', startDate: 'default' },
    },
    {
      id: 'demo-plan-atorva',
      userId: 'p-001',
      drugId: 'demo-drug-atorva',
      dose: { value: 1, unit: '片' },
      frequency: 1,
      times: ['20:00'],
      route: '口服',
      meal: '饭后',
      cycleType: 'open',
      startDate: addDaysStr(today, -30),
      endDate: null,
      status: 'active',
      source: 'manual',
      tags: { dose: 'user', frequency: 'user', times: 'assist', startDate: 'default' },
    },
    {
      id: 'demo-plan-metf',
      userId: 'p-001',
      drugId: 'demo-drug-metf',
      dose: { value: 1, unit: '片' },
      frequency: 2,
      times: ['08:00', '19:00'],
      route: '口服',
      meal: '随餐',
      cycleType: 'open',
      startDate: addDaysStr(today, -30),
      endDate: null,
      status: 'active',
      source: 'manual',
      tags: { dose: 'user', frequency: 'user', times: 'assist', startDate: 'default' },
    },
    {
      id: 'demo-plan-glip',
      userId: 'p-001',
      drugId: 'demo-drug-glip',
      dose: { value: 1, unit: '片' },
      frequency: 2,
      times: ['07:30', '17:30'],
      route: '口服',
      meal: '饭前',
      cycleType: 'open',
      startDate: addDaysStr(today, -30),
      endDate: null,
      status: 'active',
      source: 'manual',
      tags: { dose: 'user', frequency: 'user', times: 'assist', startDate: 'default' },
    },
  ])

  // 最近 30 天 records（rate/tailSkip；今天保持 pending 以便「注册即见今日任务」）。
  // T7：由 7 天拉长到 30 天——医生端队列分档按近 30 天执行率计算，窗口内需有完整数据。
  const recRows: typeof records.$inferInsert[] = []
  for (let offset = 29; offset >= 0; offset--) {
    const date = addDaysStr(today, -offset)
    for (const preset of PRESETS) {
      if (offset < preset.tailSkip) continue // 最近 tailSkip 天不记录 → pending
      for (const time of preset.times) {
        const status = hash(`${preset.planId}|${date}|${time}`) % 100 < preset.rate * 100 ? 'taken' : 'skipped'
        recRows.push({
          id: `demo-rec-${preset.planId}-${date}-${time}`,
          userId: 'p-001',
          planId: preset.planId,
          scheduledDate: date,
          scheduledTime: time,
          status,
          actedAt: now,
        })
      }
    }
  }
  if (recRows.length > 0) await db.insert(records).values(recRows)

  // 健康信息（self_reported）
  for (const [i, entry] of HEALTH.entries()) {
    await db.insert(healthProfiles).values({
      id: `demo-health-${i}`,
      userId: 'p-001',
      fieldKey: entry.fieldKey,
      value: entry.value,
      sourceMeta: { source: 'self_reported', confirmedAt: now.toISOString() },
    })
  }

  await seedQueueDemoPatients(db, today, now)

  console.log(
    `✅ demo 数据：p-001 4 药 + 4 计划 + ${recRows.length} 条 records + ${HEALTH.length} 条健康信息` +
      ` + 队列演示患者 7 人（优/中/差/未分档）｜drugMasterId 解析：amlo=${amloMaster ?? 'null'} atorva=${atorvaMaster ?? 'null'} metf=${metfMaster ?? 'null'} glip=${glipMaster ?? 'null'}` +
      '｜预期命中 ir-001(氨氯地平+阿托伐他汀) 与 ir-002(二甲双胍+格列吡嗪)',
  )
}

// CLI 入口：仅直接运行本文件时对 dev 库执行
if (process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed-demo.ts')) {
  seedDemoData()
    .then(async () => {
      await client.end()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error('❌ demo seed 失败:', err)
      await client.end().catch(() => {})
      process.exit(1)
    })
}

// ---------------------------------------------------------------------------
// T7：队列演示患者（p-101..p-107，≥8 人含 p-001，分档各异 + 漏服模式差异 + 演示风险事件）
// 分档口径 = shared gradeAdherence：优 ≥95 / 中 80–94 / 差 <80；无打卡 = 未分档。
// ---------------------------------------------------------------------------

/** 队列演示患者配置（taken/total 决定档位；consecutiveSkipTail = 末尾连续漏服天数）。 */
interface QueuePatientSpec {
  id: string
  name: string
  age: string
  gender: string
  condition: string
  drugName: string
  /** 近 30 天记录数（每日 1 次；null = 无打卡 → 未分档）。 */
  total: number | null
  taken: number
  consecutiveSkipTail: number
}

const QUEUE_PATIENTS: QueuePatientSpec[] = [
  { id: 'p-101', name: '李某某', age: '72', gender: '女', condition: '高血压', drugName: '苯磺酸氨氯地平片', total: 20, taken: 20, consecutiveSkipTail: 0 },
  { id: 'p-102', name: '王某某', age: '65', gender: '男', condition: '2型糖尿病', drugName: '盐酸二甲双胍片', total: 30, taken: 29, consecutiveSkipTail: 0 },
  { id: 'p-103', name: '赵某某', age: '70', gender: '男', condition: '高血压、高脂血症', drugName: '阿托伐他汀钙片', total: 30, taken: 26, consecutiveSkipTail: 1 },
  { id: 'p-104', name: '钱某某', age: '58', gender: '女', condition: '2型糖尿病', drugName: '格列吡嗪片', total: 30, taken: 25, consecutiveSkipTail: 2 },
  { id: 'p-105', name: '孙某某', age: '76', gender: '男', condition: '高血压、冠心病', drugName: '苯磺酸氨氯地平片', total: 30, taken: 18, consecutiveSkipTail: 3 },
  { id: 'p-106', name: '周某某', age: '81', gender: '女', condition: '高血压、2型糖尿病', drugName: '盐酸二甲双胍片', total: 30, taken: 13, consecutiveSkipTail: 12 },
  { id: 'p-107', name: '吴某某', age: '69', gender: '男', condition: '高脂血症', drugName: '阿托伐他汀钙片', total: null, taken: 0, consecutiveSkipTail: 0 },
]

/** 队列演示患者 seed（幂等：先清 p-101..p-107 旧数据；p-001 不动）。 */
async function seedQueueDemoPatients(db: typeof devDb, today: string, now: Date): Promise<void> {
  const ids = QUEUE_PATIENTS.map((p) => p.id)
  await db.delete(riskEvents).where(inArray(riskEvents.userId, ids))
  await db.delete(consultLogs).where(inArray(consultLogs.userId, ids))
  await db.delete(records).where(inArray(records.userId, ids))
  await db.delete(plans).where(inArray(plans.userId, ids))
  await db.delete(drugs).where(inArray(drugs.userId, ids))
  await db.delete(healthProfiles).where(inArray(healthProfiles.userId, ids))

  await db
    .insert(users)
    .values(QUEUE_PATIENTS.map((p) => ({ id: p.id, name: p.name, email: null, phone: null })))
    .onConflictDoUpdate({
      target: users.id,
      set: { updatedAt: now },
    })

  for (const spec of QUEUE_PATIENTS) {
    // 健康信息
    await db.insert(healthProfiles).values([
      { id: `demo-health-${spec.id}-0`, userId: spec.id, fieldKey: '性别', value: spec.gender },
      { id: `demo-health-${spec.id}-1`, userId: spec.id, fieldKey: '年龄', value: spec.age },
      { id: `demo-health-${spec.id}-2`, userId: spec.id, fieldKey: '诊断', value: spec.condition },
    ])

    // 1 药 1 计划（手动档，不挂 drugMasterId——队列演示不需要说明书命中）
    await db.insert(drugs).values({
      id: `demo-drug-${spec.id}`,
      userId: spec.id,
      genericName: spec.drugName,
      brandName: '（演示）',
      specification: '5mg',
      form: '片剂',
      manufacturer: '演示药厂',
      drugMasterId: null,
      confirmStatus: 'manual',
      stock: { value: 20, unit: '片' },
      expiry: addDaysStr(today, 180),
      confirmedAt: now,
    })
    await db.insert(plans).values({
      id: `demo-plan-${spec.id}`,
      userId: spec.id,
      drugId: `demo-drug-${spec.id}`,
      dose: { value: 1, unit: '片' },
      frequency: 1,
      times: ['08:00'],
      route: '口服',
      meal: '饭后',
      cycleType: 'open',
      startDate: addDaysStr(today, -30),
      endDate: null,
      status: 'active',
      source: 'manual',
      tags: { dose: 'user', frequency: 'user', times: 'assist', startDate: 'default' },
    })

    // 近 30 天 records：前 taken 条打卡，末尾 consecutiveSkipTail 天连续漏服（漏服时段模式差异）
    if (spec.total != null) {
      const rows: (typeof records.$inferInsert)[] = []
      for (let offset = spec.total - 1; offset >= 0; offset--) {
        const date = addDaysStr(today, -offset)
        const index = spec.total - 1 - offset // 0..total-1（按日期正序）
        const isTail = offset < spec.consecutiveSkipTail
        const status = isTail || index >= spec.taken ? 'skipped' : 'taken'
        rows.push({
          id: `demo-rec-${spec.id}-${date}`,
          userId: spec.id,
          planId: `demo-plan-${spec.id}`,
          scheduledDate: date,
          scheduledTime: '08:00',
          status,
          actedAt: now,
        })
      }
      await db.insert(records).values(rows)
    }
  }

  // 演示咨询留痕 + 风险事件（供队列时间线/患者摘要的风险事件流展示；问题文本已脱敏口径）
  await db.insert(consultLogs).values([
    {
      id: 'demo-clog-p105-l4',
      userId: 'p-105',
      question: '我胸痛得厉害还喘不上气',
      drugIds: [],
      riskLevel: 'L4',
      status: 'emergency',
      blockedAt: 'L4',
      notice: '检测到紧急风险信号，已引导立即就医。',
      citations: [],
      sectionsSnapshot: null,
    },
    {
      id: 'demo-clog-p105-l3',
      userId: 'p-105',
      question: '血压正常了，我想把氨氯地平停掉',
      drugIds: ['demo-drug-p-105'],
      riskLevel: 'L3',
      status: 'refused',
      blockedAt: 'L3',
      notice: '涉及停药调整，请咨询医生。',
      citations: [],
      sectionsSnapshot: null,
    },
    {
      id: 'demo-clog-p103-gate',
      userId: 'p-103',
      question: '这个药一次吃多少',
      drugIds: ['demo-drug-p-103'],
      riskLevel: 'L1',
      status: 'manual-gate',
      blockedAt: 'manual-gate',
      notice: '药品未经 OCR 确认，个体化解释暂不可用。',
      citations: [],
      sectionsSnapshot: null,
    },
    {
      id: 'demo-clog-p101-ok',
      userId: 'p-101',
      question: '氨氯地平是治什么的',
      drugIds: ['demo-drug-p-101'],
      riskLevel: 'L1',
      status: 'answered',
      blockedAt: null,
      notice: null,
      citations: [],
      sectionsSnapshot: null,
    },
  ])
  await db.insert(riskEvents).values([
    {
      id: 'demo-revt-p105-l4',
      userId: 'p-105',
      level: 'L4',
      type: 'emergency',
      drugId: null,
      consultLogId: 'demo-clog-p105-l4',
      detail: { matchedKeyword: '胸痛', questionRedacted: '我胸痛得厉害还喘不上气' },
      occurredAt: now,
    },
    {
      id: 'demo-revt-p105-l3',
      userId: 'p-105',
      level: 'L3',
      type: 'refused',
      drugId: 'demo-drug-p-105',
      consultLogId: 'demo-clog-p105-l3',
      detail: { matchedKeyword: '停药', questionRedacted: '血压正常了，我想把氨氯地平停掉' },
      occurredAt: now,
    },
    {
      id: 'demo-revt-p103-gate',
      userId: 'p-103',
      level: 'manual-gate',
      type: 'manual-blocked',
      drugId: 'demo-drug-p-103',
      consultLogId: 'demo-clog-p103-gate',
      detail: { matchedKeyword: null, questionRedacted: '这个药一次吃多少' },
      occurredAt: now,
    },
  ])
}
