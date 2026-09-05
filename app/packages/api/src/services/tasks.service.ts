/**
 * 今日任务服务（任务书 T7）。迁移自 demo/src/pages/Today.tsx：
 * 按生效计划（isPlanActiveOn）× times 生成当日任务，与 records 对账得每条状态（无记录=pending）。
 */
import { isPlanActiveOn, todayStr, type TaskStatus } from '@anxin/shared'
import * as plansRepo from '../repositories/plans.repo.js'
import * as drugsRepo from '../repositories/drugs.repo.js'
import * as recordsRepo from '../repositories/records.repo.js'

interface Stock {
  value: number
  unit: string
}

export interface TodayTask {
  planId: string
  drugId: string
  drugName: string
  specification: string | null
  dose: Stock
  frequency: number
  route: string | null
  cycleType: string
  endDate: string | null
  time: string
  status: TaskStatus
}

export async function getTodayTasks(userId: string, date = todayStr()) {
  const [planRows, drugRows, recordRows] = await Promise.all([
    plansRepo.listPlans(userId),
    drugsRepo.listDrugs(userId),
    recordsRepo.listRecordsByDate(userId, date),
  ])

  const activePlans = planRows.filter((p) => isPlanActiveOn(p, date))
  const items: TodayTask[] = []
  for (const plan of activePlans) {
    const drug = drugRows.find((d) => d.id === plan.drugId)
    const times = (plan.times as string[] | null) ?? []
    for (const time of times) {
      const rec = recordRows.find((r) => r.planId === plan.id && r.scheduledTime === time)
      items.push({
        planId: plan.id,
        drugId: plan.drugId,
        drugName: drug?.genericName ?? '未知药品',
        specification: drug?.specification ?? null,
        dose: plan.dose as Stock,
        frequency: plan.frequency,
        route: plan.route,
        cycleType: plan.cycleType,
        endDate: plan.endDate,
        time,
        status: (rec?.status as TaskStatus | undefined) ?? 'pending',
      })
    }
  }

  const total = items.length
  const taken = items.filter((t) => t.status === 'taken').length
  const pending = items.filter((t) => t.status === 'pending').length
  return {
    date,
    items,
    summary: { total, taken, pending, progress: total ? Math.round((taken / total) * 100) : 0 },
  }
}
