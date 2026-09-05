/**
 * 计划服务（业务逻辑）。迁移自 demo/src/App.tsx 的 savePlan / togglePausePlan / endPlan。
 * 手动建计划的默认值标注规则见任务书 T7；不接规则引擎（M2-T5 接相互作用 + 范围校验）。
 */
import {
  addDaysStr,
  estimateStockDays,
  suggestTimes,
  todayStr,
  ERR_CODES,
  type PlanCreate,
  type PlanPatch,
  type TagKind,
} from '@anxin/shared'
import * as plansRepo from '../repositories/plans.repo.js'
import * as drugsRepo from '../repositories/drugs.repo.js'
import * as recordsRepo from '../repositories/records.repo.js'
import type { PlanRow } from '../repositories/plans.repo.js'
import { ApiError } from '../lib/http.js'
import { compact, newId } from '../lib/util.js'

interface Stock {
  value: number
  unit: string
}
type Tags = Partial<Record<'dose' | 'frequency' | 'duration' | 'times' | 'startDate' | 'endDate', TagKind>>

export function toPlanDto(row: PlanRow) {
  return {
    id: row.id,
    drugId: row.drugId,
    dose: row.dose as Stock,
    frequency: row.frequency,
    times: row.times as string[],
    route: row.route,
    meal: row.meal,
    cycleType: row.cycleType,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    source: row.source,
    sourceId: row.sourceId,
    itemId: row.itemId,
    tags: row.tags as Tags | null,
  }
}

export async function listPlans(userId: string, drugId?: string) {
  const rows = await plansRepo.listPlans(userId, drugId)
  return rows.map(toPlanDto)
}

export async function getPlan(userId: string, id: string) {
  const row = await plansRepo.findPlan(userId, id)
  return row ? toPlanDto(row) : undefined
}

/**
 * 手动建计划：startDate 缺省=今天标 default；times 缺省=suggestTimes 标 assist；
 * dose/frequency=user；cycleType=stock 按库存推算 endDate 标 derived；open 无 endDate。
 */
export async function createPlan(userId: string, input: PlanCreate) {
  const drug = await drugsRepo.findDrug(userId, input.drugId)
  if (!drug) throw new ApiError(404, ERR_CODES.NOT_FOUND, '药品不存在，无法建计划')

  const startDate = input.startDate ?? todayStr()
  const hasTimes = Array.isArray(input.times) && input.times.length > 0
  const times = hasTimes ? (input.times as string[]) : suggestTimes(input.frequency)

  const tags: Tags = {
    dose: 'user',
    frequency: 'user',
    startDate: input.startDate ? 'user' : 'default',
    times: hasTimes ? 'user' : 'assist',
  }

  let endDate: string | null = input.endDate ?? null
  if (input.cycleType === 'stock') {
    const stock = drug.stock as Stock | null
    const days = stock ? estimateStockDays(stock.value, input.dose.value, input.frequency) : 0
    endDate = days > 0 ? addDaysStr(startDate, days) : null
    tags.duration = 'derived'
  } else if (input.cycleType === 'closed' && endDate) {
    tags.duration = 'user'
  }

  const row = await plansRepo.insertPlan({
    id: newId('plan'),
    userId,
    drugId: input.drugId,
    dose: input.dose,
    frequency: input.frequency,
    times,
    route: input.route ?? null,
    meal: input.meal ?? null,
    cycleType: input.cycleType,
    startDate,
    endDate,
    status: 'active',
    source: 'manual',
    tags,
  })
  return toPlanDto(row)
}

/** 暂停/恢复/结束（status）或编辑字段；只更新提供的字段。 */
export async function patchPlan(userId: string, id: string, input: PlanPatch) {
  const existing = await plansRepo.findPlan(userId, id)
  if (!existing) return undefined
  const row = await plansRepo.updatePlan(userId, id, compact({ ...input }))
  return row ? toPlanDto(row) : undefined
}

export async function deletePlan(userId: string, id: string): Promise<boolean> {
  const existing = await plansRepo.findPlan(userId, id)
  if (!existing) return false
  await recordsRepo.deleteRecordsByPlanIds(userId, [id])
  return plansRepo.deletePlan(userId, id)
}
