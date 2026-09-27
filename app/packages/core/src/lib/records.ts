/**
 * 服药记录查询/导出纯函数（M3-T6 · PRD §7.4「按日周月查询与导出」）。
 * 无 React、无副作用，可独立单测：日/周/月区间换算 + CSV 生成（前端导出，无需后端）。
 */

/** 查询粒度：日（今天）/ 周（本周一至今）/ 月（本月 1 号至今）。 */
export type RangeMode = 'day' | 'week' | 'month'

/** 服药记录状态 → 中文（导出/展示用；对齐 Home/ReminderModal 的 STATUS_LABEL）。 */
export const RECORD_STATUS_LABEL: Record<string, string> = {
  taken: '已服',
  skipped: '已跳过',
  later: '稍后提醒',
}

/** CSV 导出所需的最小记录行结构（与 GET /api/records 条目结构一致，解耦不依赖 api 层类型）。 */
export interface RecordCsvRow {
  scheduledDate: string
  scheduledTime: string
  drugName: string
  status: string
  actedAt: string
}

/** Date → 本地 ISO 日期 "YYYY-MM-DD"（用本地年月日，避免 UTC 偏移导致跨日错位）。 */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 按粒度换算 [from, to]（闭区间，to 恒为今天）：
 * - day：今天..今天
 * - week：本周一..今天（周一为一周起点）
 * - month：本月 1 号..今天
 */
export function computeRange(mode: RangeMode, now: Date = new Date()): { from: string; to: string } {
  const to = toISODate(now)
  if (mode === 'day') return { from: to, to }
  if (mode === 'week') {
    const d = new Date(now)
    const daysFromMonday = (d.getDay() + 6) % 7 // getDay: 日=0..六=6 → 周一=0..周日=6
    d.setDate(d.getDate() - daysFromMonday)
    return { from: toISODate(d), to }
  }
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: toISODate(firstOfMonth), to }
}

/** CSV 单元格转义：含逗号/引号/换行 → 双引号包裹并把内部引号翻倍（RFC 4180）。 */
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * 记录 → CSV 文本（前端生成即可，spec §T6.1）。
 * 首字节加 UTF-8 BOM（\uFEFF），保证 Excel 正确识别中文；表头中文（老年向）。
 */
export function recordsToCsv(items: RecordCsvRow[]): string {
  const header = ['日期', '时间', '药品', '状态', '操作时间']
  const rows = items.map((r) => [
    r.scheduledDate,
    r.scheduledTime,
    r.drugName,
    RECORD_STATUS_LABEL[r.status] ?? r.status,
    r.actedAt,
  ])
  const body = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  return `\uFEFF${body}`
}
