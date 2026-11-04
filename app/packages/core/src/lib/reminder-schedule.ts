/**
 * 本地到点提醒的排定计划（M5-T8）：把「生效中的计划」翻译成平台无关的通知排定项。
 *
 * 纯函数，不 import expo-notifications——RN 侧只负责把这里的 trigger 映射成原生触发器，
 * 排定策略（哪些计划、哪些日期、何时重复、上限多少）由本文件单测钉住。
 *
 * 规则：
 * - 只排 `status === 'active'` 的计划；
 * - 已开始且无结束日期（长期/用完为止）→ 每个时点一条 DAILY 重复通知：
 *   应用被杀掉后闹钟仍在，不依赖用户下次打开应用来续排；
 * - 有结束日期或尚未开始 → 逐日一次性通知，窗口 = [max(今天, startDate), min(endDate, 今天+horizon)]；
 *   应用每次启动/回前台会重排并向后滚动窗口；
 * - 今天的时点若已过（一次性档）不再排，避免刚排定就立即弹出；
 * - 总量有上限（Android 单应用闹钟有配额），按最近触发时间优先截断。
 */

export const REMINDER_ID_PREFIX = 'anxin:reminder:'

export interface ReminderPlanInput {
  planId: string
  drugName: string
  dose: { value: number; unit: string }
  times: string[]
  status: string
  startDate: string
  endDate?: string | null
}

export type ReminderTrigger =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'date'; date: string; hour: number; minute: number }

export interface ReminderNotificationSpec {
  identifier: string
  title: string
  body: string
  data: { planId: string; time: string; url: '/' }
  trigger: ReminderTrigger
}

export interface ReminderScheduleOptions {
  now?: Date
  /** 一次性通知向后滚动覆盖的天数（含今天），默认 14 天。 */
  horizonDays?: number
  /** 单次排定上限，按最近触发时间保留；默认 400（留出 Android 500 配额余量）。 */
  maxNotifications?: number
}

const DEFAULT_HORIZON_DAYS = 14
const DEFAULT_MAX_NOTIFICATIONS = 400
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day + days)
  return localDateStr(d)
}

function parseTime(time: string): { hour: number; minute: number } | null {
  const match = TIME_PATTERN.exec(time.trim())
  if (!match) return null
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

function notificationTitle(): string {
  return '该服药了'
}

function notificationBody(plan: ReminderPlanInput, time: string): string {
  return `${plan.drugName} · 每次${plan.dose.value}${plan.dose.unit} · ${time}`
}

/**
 * 计划列表 → 通知排定项（按最近触发时间排序）。
 * 同一计划内重复的时点会去重；非法时点（非 HH:MM）直接丢弃。
 */
export function planReminderNotifications(
  plans: ReminderPlanInput[],
  options: ReminderScheduleOptions = {},
): ReminderNotificationSpec[] {
  const now = options.now ?? new Date()
  const horizonDays = Math.max(1, Math.floor(options.horizonDays ?? DEFAULT_HORIZON_DAYS))
  const maxNotifications = Math.max(1, Math.floor(options.maxNotifications ?? DEFAULT_MAX_NOTIFICATIONS))
  const today = localDateStr(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const horizonEnd = addDays(today, horizonDays - 1)

  const entries: Array<{ sortAt: number; spec: ReminderNotificationSpec }> = []

  for (const plan of plans) {
    if (plan.status !== 'active') continue
    const times = [...new Set(plan.times.map((time) => time.trim()))]
      .map((time) => ({ time, parsed: parseTime(time) }))
      .filter((item): item is { time: string; parsed: { hour: number; minute: number } } =>
        item.parsed !== null,
      )
      .sort((a, b) => a.time.localeCompare(b.time))
    if (times.length === 0) continue
    if (plan.startDate > horizonEnd) continue
    if (plan.endDate && plan.endDate < today) continue

    const started = plan.startDate <= today
    const openEnded = !plan.endDate

    if (started && openEnded) {
      for (const { time, parsed } of times) {
        const identifier = `${REMINDER_ID_PREFIX}${plan.planId}:${time}`
        const minutes = parsed.hour * 60 + parsed.minute
        const daysAhead = minutes > nowMinutes ? 0 : 1
        entries.push({
          sortAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, parsed.hour, parsed.minute).getTime(),
          spec: {
            identifier,
            title: notificationTitle(),
            body: notificationBody(plan, time),
            data: { planId: plan.planId, time, url: '/' },
            trigger: { kind: 'daily', hour: parsed.hour, minute: parsed.minute },
          },
        })
      }
      continue
    }

    const firstDate = started ? today : plan.startDate
    const lastDate = plan.endDate && plan.endDate < horizonEnd ? plan.endDate : horizonEnd
    let cursor = firstDate
    let guard = 0
    while (cursor <= lastDate && guard < 366) {
      guard += 1
      const isToday = cursor === today
      for (const { time, parsed } of times) {
        if (isToday && parsed.hour * 60 + parsed.minute <= nowMinutes) continue
        const identifier = `${REMINDER_ID_PREFIX}${plan.planId}:${cursor}:${time}`
        const [year, month, day] = cursor.split('-').map(Number)
        entries.push({
          sortAt: new Date(year, month - 1, day, parsed.hour, parsed.minute).getTime(),
          spec: {
            identifier,
            title: notificationTitle(),
            body: notificationBody(plan, time),
            data: { planId: plan.planId, time, url: '/' },
            trigger: { kind: 'date', date: cursor, hour: parsed.hour, minute: parsed.minute },
          },
        })
      }
      cursor = addDays(cursor, 1)
    }
  }

  entries.sort((a, b) => a.sortAt - b.sortAt || a.spec.identifier.localeCompare(b.spec.identifier))
  return entries.slice(0, maxNotifications).map((entry) => entry.spec)
}
