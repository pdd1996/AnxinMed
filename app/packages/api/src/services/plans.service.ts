/**
 * 计划服务（业务逻辑）。迁移自 demo/src/App.tsx 的 savePlan / togglePausePlan / endPlan。
 * 手动建计划的默认值标注规则见任务书 T7；不接规则引擎（M2-T5 接相互作用 + 范围校验）。
 */
import {
  addDaysStr,
  estimateStockDays,
  isPlanActiveOn,
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
import * as assetsRepo from '../repositories/assets.repo.js'
import type { PlanRow } from '../repositories/plans.repo.js'
import type { DrugRow } from '../repositories/drugs.repo.js'
import {
  checkDosageRange,
  checkInteractions,
  type DosageRangeResult,
  type InteractionResult,
  type InteractionRuleInput,
  type PackageInsertDosage,
} from './rules/index.js'
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

/** createPlan 返回：计划 DTO + 相互作用 + 范围校验（后两者只标注，不阻止创建）。
 * 用 type 别名（非 interface）：满足 okJson 的 `Record<string, unknown>` 约束（interface 无隐式索引签名）。 */
export type CreatePlanResult = {
  plan: ReturnType<typeof toPlanDto>
  interactions: InteractionResult
  dosageRange: DosageRangeResult
}

/**
 * 建计划时的规则检查（PRD §7.8.2 时机二 / §8.3）：相互作用对「生效计划集合 + 即将新建的药」，
 * 范围校验对新计划的药。只标注不阻止；资产库缺数据时引擎自然返回空/none（不报错、不阻断建计划）。
 */
async function runRuleChecks(
  userId: string,
  newDrug: DrugRow,
  planDraft: { dose: Stock; frequency: number },
): Promise<{ interactions: InteractionResult; dosageRange: DosageRangeResult }> {
  const today = todayStr()
  const [planRows, drugRows] = await Promise.all([plansRepo.listPlans(userId), drugsRepo.listDrugs(userId)])

  // 生效计划集合（active 且时间窗覆盖今日）→ 药的 drugMasterId（手动建档 masterId=null 排除）
  const activeMasterIds = drugRows
    .filter((d) => d.drugMasterId && planRows.some((p) => p.drugId === d.id && isPlanActiveOn(p, today)))
    .map((d) => d.drugMasterId as string)
  const masterIds = [...new Set([...activeMasterIds, ...(newDrug.drugMasterId ? [newDrug.drugMasterId] : [])])]

  const ruleRows = await assetsRepo.listInteractionRules()
  const rules: InteractionRuleInput[] = ruleRows.map((r) => ({
    id: r.id,
    drugIds: (r.drugIds as string[] | null) ?? [],
    level: r.level,
    note: r.note,
    source: r.source,
  }))
  const names = await assetsRepo.findDrugMasterNames(masterIds)
  const interactions = checkInteractions(masterIds, rules, names)

  const insertRow = newDrug.drugMasterId
    ? await assetsRepo.findPackageInsertByDrugMasterId(newDrug.drugMasterId)
    : undefined
  const insertSlice: PackageInsertDosage | null = insertRow
    ? {
        dosage: insertRow.dosage as PackageInsertDosage['dosage'],
        source: insertRow.source,
        version: insertRow.version,
      }
    : null
  const dosageRange = checkDosageRange(planDraft, insertSlice)

  return { interactions, dosageRange }
}

/**
 * 手动建计划：startDate 缺省=今天标 default；times 缺省=suggestTimes 标 assist；
 * dose/frequency=user；cycleType=stock 按库存推算 endDate 标 derived；open 无 endDate。
 */
export async function createPlan(userId: string, input: PlanCreate): Promise<CreatePlanResult> {
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

  // 规则检查（相互作用 + 范围校验）：只标注不阻止，随响应返回（PRD §7.8.2 / §8.3）
  const { interactions, dosageRange } = await runRuleChecks(userId, drug, {
    dose: input.dose,
    frequency: input.frequency,
  })

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
  return { plan: toPlanDto(row), interactions, dosageRange }
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
