/**
 * 医生端洞察数据访问（M3-T3 · PRD §7.7）——5 个只读工具的 DB 查询。
 *
 * 数据源从 demo 的 mock JSON 改读 PostgreSQL（spec §T3）：
 *   1. 患者列表：users + health_profiles（聚合 gender/age/conditions）+ 生效计划数 + 最近活跃
 *   2. 依从性统计：records 聚合（PG 原生 SQL `count(*) filter`，spec §T3.1 硬要求）
 *   3. 最近用药集合：drugs JOIN plans（生效计划）
 *   4. 临期库存：drugs 按 expiry 分类（临期 ≤30 天 / 过期 / 低库存 ≤10）
 *   5. 风险事件流：复用 consult.repo（listRiskEvents / listConsultLogs / countBlockedConsults）
 *
 * 分层纪律（M1-T7）：全部 userId 过滤（医生端 MVP 为演示模式，暂不做多医生权限）。
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { drugs, healthProfiles, plans, records, users } from '../db/schema.js'
import { isPlanActiveOn, todayStr, addDaysStr } from '@anxin/shared'

// ---------------------------------------------------------------------------
// 1. 患者列表（users + health_profiles + 生效计划数 + 最近活跃）
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
}

/**
 * 患者列表 + 概要（迁移 demo:1297-1311，统计改 SQL）。
 * - health_profiles 按 fieldKey 聚合（性别/年龄/诊断）；
 * - drugCount = 生效计划数（active 且时间窗覆盖今日）；
 * - lastActiveAt = 最近 records.actedAt（无记录则 null）。
 */
export async function listPatientsWithStats(): Promise<PatientListItem[]> {
  const userRows = await db.select().from(users).orderBy(users.id)
  const out: PatientListItem[] = []

  for (const user of userRows) {
    // health_profiles 聚合
    const healthRows = await db
      .select()
      .from(healthProfiles)
      .where(eq(healthProfiles.userId, user.id))
    const fieldMap = new Map(healthRows.map((h) => [h.fieldKey, h.value]))
    const gender = fieldMap.get('性别') ?? null
    const ageStr = fieldMap.get('年龄')
    const age = ageStr ? parseInt(ageStr, 10) || null : null
    const conditionsStr = fieldMap.get('诊断') ?? ''
    const conditions = conditionsStr ? conditionsStr.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) : []

    // 生效计划数（active 且时间窗覆盖今日）
    const today = todayStr()
    const planRows = await db.select().from(plans).where(eq(plans.userId, user.id))
    const drugCount = planRows.filter((p) => isPlanActiveOn(p, today)).length

    // 最近活跃（records.actedAt 降序取第一条）
    const [lastRecord] = await db
      .select({ actedAt: records.actedAt })
      .from(records)
      .where(eq(records.userId, user.id))
      .orderBy(desc(records.actedAt))
      .limit(1)

    out.push({
      id: user.id,
      name: user.name,
      age,
      gender,
      conditions,
      drugCount,
      enrolledAt: user.createdAt.toISOString().slice(0, 10),
      lastActiveAt: lastRecord?.actedAt ? lastRecord.actedAt.toISOString().slice(0, 10) : null,
    })
  }

  return out
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

/** 两日期相差天数（to − from）；非法输入返回 0。 */
function daysBetween(from: string, to: string): number {
  const a = new Date(from)
  const b = new Date(to)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}
