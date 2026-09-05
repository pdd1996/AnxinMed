/**
 * 领域纯函数 —— 照搬 demo/src/lib.ts（权威形态）。
 * 零 I/O、确定性，Vitest 覆盖（见 lib.test.ts）。
 *
 * 日期约定：入参/出参为 ISO 日期字符串 "YYYY-MM-DD"；时间点为 "HH:MM"。
 * 注：addDaysStr/todayStr 按本地时区取日历日（与 demo 一致，dev/CI 均为 UTC+ 或 UTC，行为正确）。
 */

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
