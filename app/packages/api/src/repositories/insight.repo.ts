/**
 * 医生端洞察数据访问（M3-T3 · PRD §7.7）——5 个只读工具的 DB 查询 + T7 队列级聚合。
 *
 * 数据源从 demo 的 mock JSON 改读 PostgreSQL（spec §T3）：
 *   1. 患者列表：users + health_profiles（聚合 gender/age/conditions）+ 生效计划数 + 最近活跃
 *      （T7 改造：逐用户循环 → 常数次聚合 SQL，患者数无关查询数，spec §T7.2 无 N+1 硬要求）
 *   2. 依从性统计：records 聚合（PG 原生 SQL `count(*) filter`，spec §T3.1 硬要求）
 *   3. 最近用药集合：drugs JOIN plans（生效计划）
 *   4. 临期库存：drugs 按 expiry 分类（临期 ≤30 天 / 过期 / 低库存 ≤10）
 *   5. 风险事件流：复用 consult.repo（listRiskEvents / listConsultLogs / countBlockedConsults）
 *   6. T7 队列：getAdherenceByUser（全体患者执行率）/ listRiskEventsWindow（窗口内事件原始行）
 *
 * 分层纪律（M1-T7）：全部只读；分档判定不在 SQL——统一走 @anxin/shared gradeAdherence
 * （ADR #17 第 3 条：分档口径一份真相，可审计、可复现）。
 * 医生端 MVP 为演示模式，暂不做多医生权限。
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { drugs, healthProfiles, insightAskLogs, plans, records, riskEvents, users } from '../db/schema.js'
import { todayStr, addDaysStr, gradeAdherence } from '@anxin/shared'

// ---------------------------------------------------------------------------
// 1. 患者列表（users + health_profiles + 生效计划数 + 最近活跃 + T7 依从性分档）
// ---------------------------------------------------------------------------

export interface PatientListItem {
  id: string
  name: string | null
  age: number | null
  gender: string | null
  conditions: string[]
  drugCount: number
  enrolledAt: string
  lastActiveAt: string | null
  /** 近 30 天执行率（百分比整数）；窗口内无打卡记录为 null（未分档）。 */
  adherenceRate: number | null
  /** shared gradeAdherence 分档（优/中/差）；无记录为 null。 */
  adherenceGrade: 'good' | 'fair' | 'poor' | null
}

/** 全体患者近 N 天执行率快照（records `count(*) filter` 按 user 聚合；T7 队列工具共用）。 */
export interface AdherenceByUser {
  userId: string
  total: number
  taken: number
  skipped: number
  /** 百分比整数；total=0 时为 null。 */
  rate: number | null
}

/** 全体患者近 N 天执行率（常数 1 次查询；shared gradeAdherence 在调用方分档）。 */export async function getAdherenceByUser(days = 30): Promise<AdherenceByUser[]> {
  const cutoff = addDaysStr(todayStr(), -days + 1)
  const rows = await db
    .select({
      userId: records.userId,
      total: sql<number>`count(*)::int`,
      taken: sql<number>`count(*) filter (where ${records.status} = 'taken')::int`,
      skipped: sql<number>`count(*) filter (where ${records.status} = 'skipped')::int`,
    })
    .from(records)
    .where(gte(records.scheduledDate, cutoff))
    .groupBy(records.userId)
  return rows.map((r) => ({ ...r, rate: r.total > 0 ? Math.round((r.taken / r.total) * 100) : null }))
}

/**
 * 患者列表 + 概要（迁移 demo:1297-1311；T7.2 改造为常数 4 次聚合查询，无 N+1）。
 * - health_profiles 全量取回按 user 分组（性别/年龄/诊断）；
 * - drugCount = 生效计划数（SQL `count(*) filter` 复刻 shared isPlanActiveOn 口径）；
 * - lastActiveAt = max(records.actedAt)；
 * - adherenceRate/Grade = 近 30 天执行率 + shared gradeAdherence 分档。
 */
export async function listPatientsWithStats(days = 30): Promise<PatientListItem[]> {
  const today = todayStr()
  const cutoff = addDaysStr(today, -days + 1)

  // 常数 4 次查询（患者数无关；原实现逐用户 3-4 次循环 → N+1，spec §T7.2 硬要求改造）
  const [userRows, healthRows, planCounts, adherence, lastActives] = await Promise.all([
    db.select().from(users).orderBy(users.id),
    db.select().from(healthProfiles),
    db
      .select({
        userId: plans.userId,
        drugCount: sql<number>`count(*) filter (where ${plans.status} = 'active' and ${plans.startDate} <= ${today} and (${plans.endDate} is null or ${plans.endDate} >= ${today}))::int`,
      })
      .from(plans)
      .groupBy(plans.userId),
    getAdherenceByUser(days),
    // 最近活跃：max(actedAt) 按 user 聚合（口径同 T3 的 actedAt 最新一条）；
    // postgres-js 对聚合表达式不套 Date 解码器 → ::text 取回再转 ISO 日期
    db
      .select({ userId: records.userId, lastActiveAt: sql<string | null>`max(${records.actedAt})::text` })
      .from(records)
      .where(gte(records.scheduledDate, cutoff))
      .groupBy(records.userId),
  ])

  const healthByUser = new Map<string, Map<string, string | null>>()
  for (const h of healthRows) {
    if (!healthByUser.has(h.userId)) healthByUser.set(h.userId, new Map())
    healthByUser.get(h.userId)!.set(h.fieldKey, h.value)
  }
  const planCountByUser = new Map(planCounts.map((p) => [p.userId, p.drugCount]))
  const adherenceByUser = new Map(adherence.map((a) => [a.userId, a]))
  const lastActiveByUser = new Map(lastActives.map((r) => [r.userId, r.lastActiveAt]))

  return userRows.map((user) => {
    const fieldMap = healthByUser.get(user.id) ?? new Map<string, string | null>()
    const gender = fieldMap.get('性别') ?? null
    const ageStr = fieldMap.get('年龄')
    const age = ageStr ? parseInt(ageStr, 10) || null : null
    const conditionsStr = fieldMap.get('诊断') ?? ''
    const conditions = conditionsStr ? conditionsStr.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) : []

    const stats = adherenceByUser.get(user.id)
    const rate = stats?.rate ?? null

    return {
      id: user.id,
      name: user.name,
      age,
      gender,
      conditions,
      drugCount: planCountByUser.get(user.id) ?? 0,
      enrolledAt: user.createdAt.toISOString().slice(0, 10),
      lastActiveAt: toIsoDate(lastActiveByUser.get(user.id)),
      adherenceRate: rate,
      adherenceGrade: gradeAdherence(rate),
    }
  })
}

// ---------------------------------------------------------------------------
// 2. 依从性统计（records 聚合，PG 原生 SQL `count(*) filter`）
// ---------------------------------------------------------------------------

export interface AdherenceStats {
  rate: number
  taken: number
  skipped: number
  total: number
  consecutiveSkip: number
  skipDetails: Array<{ date: string; drugId: string }>
  dateRange: number
}

/**
 * 近 N 天依从性统计（spec §T3.1：PG 原生 SQL `count(*) filter`）。
 * - rate = taken / total * 100（四舍五入）；
 * - consecutiveSkip = 最近连续漏服次数（按 scheduledDate 降序，遇到 taken 停止）；
 * - skipDetails = 最近 5 条漏服明细（date + drugId）。
 */
export async function getAdherenceStats(userId: string, days = 30): Promise<AdherenceStats> {
  const cutoff = addDaysStr(todayStr(), -days + 1)

  // PG 原生 SQL：count(*) filter (where status = 'taken')
  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      taken: sql<number>`count(*) filter (where ${records.status} = 'taken')::int`,
      skipped: sql<number>`count(*) filter (where ${records.status} = 'skipped')::int`,
    })
    .from(records)
    .where(and(eq(records.userId, userId), gte(records.scheduledDate, cutoff)))

  const total = agg?.total ?? 0
  const taken = agg?.taken ?? 0
  const skipped = agg?.skipped ?? 0
  const rate = total > 0 ? Math.round((taken / total) * 100) : 0

  // 连续漏服（按 scheduledDate 降序，遇到 taken 停止）
  const recentRows = await db
    .select({
      scheduledDate: records.scheduledDate,
      status: records.status,
      planId: records.planId,
    })
    .from(records)
    .where(and(eq(records.userId, userId), gte(records.scheduledDate, cutoff)))
    .orderBy(desc(records.scheduledDate))

  let consecutiveSkip = 0
  for (const r of recentRows) {
    if (r.status === 'skipped') consecutiveSkip++
    else break
  }

  // 漏服明细（最近 5 条）
  const skipDetails = recentRows
    .filter((r) => r.status === 'skipped')
    .slice(0, 5)
    .map((r) => ({ date: r.scheduledDate, drugId: r.planId })) // planId 作为 drugId 的近似（MVP 简化）

  return { rate, taken, skipped, total, consecutiveSkip, skipDetails, dateRange: days }
}

// ---------------------------------------------------------------------------
// 3. 最近用药集合（drugs JOIN plans）
// ---------------------------------------------------------------------------

export interface MedicationItem {
  id: string
  genericName: string
  brandName: string | null
  specification: string | null
  form: string | null
  stock: { value: number; unit: string } | null
  expiry: string | null
}

/** 用药清单（drugs 全量；医生端看的是药箱，不是生效计划）。 */
export async function getMedicationList(userId: string): Promise<MedicationItem[]> {
  const drugRows = await db.select().from(drugs).where(eq(drugs.userId, userId)).orderBy(desc(drugs.createdAt))
  return drugRows.map((d) => ({
    id: d.id,
    genericName: d.genericName,
    brandName: d.brandName,
    specification: d.specification,
    form: d.form,
    stock: d.stock as { value: number; unit: string } | null,
    expiry: d.expiry,
  }))
}

// ---------------------------------------------------------------------------
// 4. 临期库存（drugs 按 expiry 分类）
// ---------------------------------------------------------------------------

export interface ExpiryStatus {
  expiring: Array<MedicationItem & { days: number }>
  expired: Array<MedicationItem & { days: number }>
  lowStock: MedicationItem[]
}

/** 临期/过期/低库存分类（照搬 demo:1163-1179，阈值：临期 ≤30 天、低库存 ≤10）。 */
export async function getExpiryStatus(userId: string): Promise<ExpiryStatus> {
  const today = todayStr()
  const meds = await getMedicationList(userId)
  const expiring: Array<MedicationItem & { days: number }> = []
  const expired: Array<MedicationItem & { days: number }> = []
  const lowStock: MedicationItem[] = []

  for (const m of meds) {
    if (m.expiry) {
      const days = daysBetween(today, m.expiry)
      if (days < 0) expired.push({ ...m, days })
      else if (days <= 30) expiring.push({ ...m, days })
    }
    if (m.stock && m.stock.value <= 10) lowStock.push(m)
  }

  return { expiring, expired, lowStock }
}

/** 时间戳（postgres text 形态）→ ISO 日期 "YYYY-MM-DD"；空/非法返回 null（口径同 toISOString 的 UTC 日）。 */
function toIsoDate(v: string | null | undefined): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** 两日期相差天数（to − from）；非法输入返回 0。 */
function daysBetween(from: string, to: string): number {
  const a = new Date(from)
  const b = new Date(to)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

// ---------------------------------------------------------------------------
// 6. T7 队列：风险事件窗口原始行（时间线聚合在 service 层按 UTC 日 × 级别分组，口径同 toRiskEventItem）
// ---------------------------------------------------------------------------

export interface RiskEventWindowRow {
  date: string
  level: 'L4' | 'L3' | 'manual-gate'
}

/**
 * 窗口内全体患者风险事件原始行（date = occurredAt UTC 日，与 insight/types.ts toRiskEventItem 同口径）。
 * 仅 L4/L3/manual-gate 会写入 risk_events（consult.service 落库纪律），无需再过滤。
 */
export async function listRiskEventsWindow(days = 30): Promise<RiskEventWindowRow[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const rows = await db
    .select({ occurredAt: riskEvents.occurredAt, level: riskEvents.level })
    .from(riskEvents)
    .where(gte(riskEvents.occurredAt, since))
  return rows.map((r) => ({ date: r.occurredAt.toISOString().slice(0, 10), level: r.level }))
}

// ---------------------------------------------------------------------------
// 7. T7 问答留痕（ADR #17 保留项：漏判留痕 = 扩工具依据，绝不放开 SQL）
// ---------------------------------------------------------------------------

/** 患者存在性检查（ask 患者维度问法的 404 前置；轻量单行查询）。 */
export async function findPatient(id: string) {
  const [row] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, id)).limit(1)
  return row ?? null
}

/** 医生问答留痕（每问一行；question 为脱敏后文本——L3 出口约束）。 */
export async function insertAskLog(row: typeof insightAskLogs.$inferInsert): Promise<void> {
  await db.insert(insightAskLogs).values(row)
}
