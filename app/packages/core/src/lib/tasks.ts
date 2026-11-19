/**
 * 今日任务纯函数（可单测）：把 (plan,time) 粒度的任务项按 plan 分组，供任务卡渲染。
 */
export type TaskStatus = 'pending' | 'taken' | 'skipped' | 'later'

export interface TaskSlot {
  time: string
  status: TaskStatus
}

export interface PlanGroup {
  planId: string
  drugId: string
  drugName: string
  specification: string | null
  dose: { value: number; unit: string }
  frequency: number
  route: string | null
  cycleType: string
  endDate: string | null
  slots: TaskSlot[]
}

export interface TodayTaskItem {
  planId: string
  drugId: string
  drugName: string
  specification: string | null
  dose: { value: number; unit: string }
  frequency: number
  route: string | null
  cycleType: string
  endDate: string | null
  time: string
  status: TaskStatus
}

/** 按 planId 分组并保持首次出现顺序；slots 按 time 排序。 */
export function groupTasksByPlan(items: TodayTaskItem[]): PlanGroup[] {
  const map = new Map<string, PlanGroup>()
  for (const item of items) {
    let group = map.get(item.planId)
    if (!group) {
      group = {
        planId: item.planId,
        drugId: item.drugId,
        drugName: item.drugName,
        specification: item.specification,
        dose: item.dose,
        frequency: item.frequency,
        route: item.route,
        cycleType: item.cycleType,
        endDate: item.endDate,
        slots: [],
      }
      map.set(item.planId, group)
    }
    group.slots.push({ time: item.time, status: item.status })
  }
  for (const group of map.values()) group.slots.sort((a, b) => a.time.localeCompare(b.time))
  return [...map.values()]
}

/** 当前 HH:MM（本地），用于判断某时间点是否已到（提醒轮询比对）。 */
export function nowHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 到点仍未处理（pending）的时间点 → 触发提醒。 */
export function duePendingSlots(group: PlanGroup, now = nowHHMM()): TaskSlot[] {
  return group.slots.filter((s) => s.status === 'pending' && s.time <= now)
}

/**
 * 用法摘要分段（规格 / 每次 / 每日 / 途径），缺省项跳过。
 *
 * 分段而不是拼成一整句：渲染端按段包「不换行」盒子，折行只发生在段与段之间，
 * 不会把「每日 1 次」拆成「每日 1 / 次」或「每 / 日 1 次」（375px + 大字档实测踩过）。
 * web/mobile 提醒弹窗共用。
 */
export function planMetaSegments(
  group: Pick<PlanGroup, 'specification' | 'dose' | 'frequency' | 'route'>,
): string[] {
  return [
    group.specification,
    `每次 ${group.dose.value} ${group.dose.unit}`,
    `每日 ${group.frequency} 次`,
    group.route,
  ].filter((item): item is string => Boolean(item))
}
