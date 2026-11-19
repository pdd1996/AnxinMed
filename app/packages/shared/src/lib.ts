/**
 * 领域纯函数 —— 照搬 demo/src/lib.ts（权威形态）。
 * 零 I/O、确定性，Vitest 覆盖（见 lib.test.ts）。
 *
 * 日期约定：入参/出参为 ISO 日期字符串 "YYYY-MM-DD"；时间点为 "HH:MM"。
 * 注：addDaysStr/todayStr 按本地时区取日历日（与 demo 一致，dev/CI 均为 UTC+ 或 UTC，行为正确）。
 */
import type { AdherenceGrade } from './enums.js'

/** 今天（本地时区）→ "YYYY-MM-DD" */
export function todayStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** 日期 + N 天 → "YYYY-MM-DD"；非法输入返回空串 */
export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 两日期相差天数（to − from）；非法输入返回 0 */
export function daysBetween(from: string, to: string): number {
  const a = new Date(from)
  const b = new Date(to)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/**
 * 是否为合法日历日（"YYYY-MM-DD"，月/日真实存在）。
 * 注意：`new Date('2026-02-31')` 会被 JS 宽容进位成 3 月，故必须用 UTC 三元组回读校验。
 * 只校验形态，不校验业务语义（是否已过期、是否未来）——后者由读取侧判定。
 */
export function isIsoDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  )
}

// ---------------------------------------------------------------------------
// 效期状态（三条时间线之一）：阈值一份真相，患者端提醒 / 咨询 S2 / 医生端共用
// ---------------------------------------------------------------------------

/** 临期预警阈值（天）：距到期 ≤30 天为「临期」，已过期为「已过期」（用户 2026-11-19 拍板 30 天）。 */
export const EXPIRY_WARNING_DAYS = 30

/** 效期状态：已过期 / 临期（含当天）/ 正常。 */
export type ExpiryState = 'expired' | 'expiring' | 'ok'

/** 距到期天数（to − today，负 = 已过期）；无/非法日期 → null（未录入 ≠ 没有过期，调用方必须分开处理）。 */
export function daysUntilExpiry(
  expiry: string | null | undefined,
  today: string = todayStr(),
): number | null {
  if (!expiry || !isIsoDate(expiry)) return null
  return daysBetween(today, expiry)
}

/**
 * 有效期状态（纯函数，阈值 EXPIRY_WARNING_DAYS）。
 * 返回 null 表示「未录入/非法日期」——调用方不得把它当成 ok（与 M14 库存 unknownStock 同口径）。
 */
export function expiryState(
  expiry: string | null | undefined,
  today: string = todayStr(),
): ExpiryState | null {
  const days = daysUntilExpiry(expiry, today)
  if (days === null) return null
  if (days < 0) return 'expired'
  if (days <= EXPIRY_WARNING_DAYS) return 'expiring'
  return 'ok'
}

/** 库存按次扣减下的预计可用天数（推算标注）；每日用量 ≤ 0 返回 0 */
export function estimateStockDays(stock: number, doseValue: number, frequency: number): number {
  const perDay = (doseValue || 0) * (frequency || 0)
  if (perDay <= 0) return 0
  return Math.floor(stock / perDay)
}

/** 按频次在 8:00–22:00 均匀分布生成建议时间点（每日 4 次 → 8/12/16/20）；频次 clamp 到 1..8 */
export function suggestTimes(frequency: number): string[] {
  const n = Math.max(1, Math.min(8, Math.floor(Number(frequency) || 1)))
  if (n === 1) return ['08:00']
  return Array.from({ length: n }, (_, i) => `${String(8 + Math.round((12 * i) / (n - 1))).padStart(2, '0')}:00`)
}

/** 计划在某日是否生效：status=active 且 startDate ≤ date ≤ endDate（endDate 为空 = 开放式，长期生效） */
export function isPlanActiveOn(
  plan: { status: string; startDate: string; endDate?: string | null },
  date: string,
): boolean {
  return plan.status === 'active' && plan.startDate <= date && (!plan.endDate || plan.endDate >= date)
}

// ---------------------------------------------------------------------------
// 依从性分档（T7 · ADR #17 第 3 条：分档口径确定性、可审计、可复现）
// ---------------------------------------------------------------------------

/** 分档阈值（执行率百分比，与 api insight.repo 近 30 天 `count(*) filter` 口径同源）。 */
export const ADHERENCE_GRADE_THRESHOLDS = { good: 95, fair: 80 } as const

/**
 * 执行率 → 依从性分档（纯函数）：优 ≥95 / 中 80–94 / 差 <80。
 * rate 缺失（近 N 天无打卡记录）返回 null——调用方落「未分档」，绝不臆测为差。
 */
export function gradeAdherence(rate: number | null | undefined): AdherenceGrade | null {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return null
  if (rate >= ADHERENCE_GRADE_THRESHOLDS.good) return 'good'
  if (rate >= ADHERENCE_GRADE_THRESHOLDS.fair) return 'fair'
  return 'poor'
}

/** 分档 → 医生可读标签（api 数据模板与 web 队列视图共用，展示口径一份真相）。 */
export const ADHERENCE_GRADE_LABEL: Record<AdherenceGrade, string> = {
  good: '优',
  fair: '中',
  poor: '差',
}
