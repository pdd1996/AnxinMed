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
import type { InteractionRuleRow } from '../repositories/assets.repo.js'
import type { PlanRow } from '../repositories/plans.repo.js'
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

/** 生效集合快照（检查对象 = 在服计划集合，不是药箱库存；PRD §7.8.2）。 */
export interface ActiveMedicationSnapshot {
  /** 今日时间窗内 status=active 的计划数（含未关联标准药品库的药）。 */
  activePlanCount: number
  /** 生效集合内可参与规则匹配的 drug_master.id（去重）。 */
  activeMasterIds: string[]
  /** 参与比对的在服药品通用名（已关联标准库）。 */
  checkedDrugNames: string[]
  /** 在服但未关联标准药品库、无法参与比对的药品通用名（诚实披露，不静默跳过）。 */
  skippedDrugNames: string[]
}

/** 规则库统计（UI 诚实披露覆盖范围用）。 */
export interface RuleLibraryStats {
  total: number
  demo: number
  curated: number
}

/** 规则行 → 引擎入参（唯一映射处；安全汇总/入箱预检/咨询同源）。 */
export function toInteractionRuleInputs(rows: InteractionRuleRow[]): InteractionRuleInput[] {
  return rows.map((r) => ({
    id: r.id,
    drugIds: (r.drugIds as string[] | null) ?? [],
    drugGroups: (r.drugGroups as string[][] | null) ?? null,
    level: r.level,
    status: r.status,
    note: r.note,
    source: r.source,
  }))
}

export function countRuleLibrary(rows: InteractionRuleRow[]): RuleLibraryStats {
  let demo = 0
  let curated = 0
  for (const r of rows) {
    if (r.status === 'demo') demo += 1
    else if (r.status === 'curated') curated += 1
  }
  return { total: rows.length, demo, curated }
}

/** 生效计划集合（status=active 且时间窗覆盖今日）→ 可比对药品与无法比对的药。 */
export async function resolveActiveMedications(userId: string): Promise<ActiveMedicationSnapshot> {
  const today = todayStr()
  const [planRows, drugRows] = await Promise.all([plansRepo.listPlans(userId), drugsRepo.listDrugs(userId)])
  const activePlanCount = planRows.filter((p) => isPlanActiveOn(p, today)).length
  const activeDrugs = drugRows.filter((d) =>
    planRows.some((p) => p.drugId === d.id && isPlanActiveOn(p, today)),
  )
  const checked = activeDrugs.filter((d) => !!d.drugMasterId)
  return {
    activePlanCount,
    activeMasterIds: [...new Set(checked.map((d) => d.drugMasterId as string))],
    checkedDrugNames: checked.map((d) => d.genericName),
    skippedDrugNames: activeDrugs.filter((d) => !d.drugMasterId).map((d) => d.genericName),
  }
}

/**
 * 生效集合的相互作用检查（V2.5 · PRD §7.8.2「主动干预」）：
 * 患者端常驻安全卡（GET /api/safety）与计划变更重跑共用；0 次 LLM。
 * 规则条目只匹配、不生成（PRD §7.8.1）。
 */
export async function checkActiveInteractions(userId: string): Promise<{
  interactions: InteractionResult
  snapshot: ActiveMedicationSnapshot
  ruleLibrary: RuleLibraryStats
}> {
  const snapshot = await resolveActiveMedications(userId)
  const ruleRows = await assetsRepo.listInteractionRules()
  const rules = toInteractionRuleInputs(ruleRows)
  const names = await assetsRepo.findDrugMasterNames(snapshot.activeMasterIds)
  return {
    interactions: checkInteractions(snapshot.activeMasterIds, rules, names),
    snapshot,
    ruleLibrary: countRuleLibrary(ruleRows),
  }
}

/**
 * 建计划/确认时的规则检查（PRD §7.8.2 时机二 / §8.3）：相互作用对「生效计划集合 + 即将新建的药」，
 * 范围校验对新计划的药。只标注不阻止；资产库缺数据时引擎自然返回空/none（不报错、不阻断建计划）。
 * 两条接入路径共用：手动建计划（createPlan）与草稿确认（drafts.service.confirmDraft 对最终值重跑）。
 */
export async function runRuleChecks(
  userId: string,
  newDrugMasterId: string | null,
  planDraft: { dose: Stock; frequency: number },
): Promise<{ interactions: InteractionResult; dosageRange: DosageRangeResult }> {
  // 生效计划集合（active 且时间窗覆盖今日）→ 药的 drugMasterId（手动建档 masterId=null 排除）
  const snapshot = await resolveActiveMedications(userId)
  const masterIds = [
    ...new Set([...snapshot.activeMasterIds, ...(newDrugMasterId ? [newDrugMasterId] : [])]),
  ]

  const ruleRows = await assetsRepo.listInteractionRules()
  const rules = toInteractionRuleInputs(ruleRows)
  const names = await assetsRepo.findDrugMasterNames(masterIds)
  const interactions = checkInteractions(masterIds, rules, names)

  const insertRow = newDrugMasterId
    ? await assetsRepo.findPackageInsertByDrugMasterId(newDrugMasterId)
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
  const { interactions, dosageRange } = await runRuleChecks(userId, drug.drugMasterId ?? null, {
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

/**
 * 暂停/恢复/结束（status）或编辑字段；只更新提供的字段。
 * V2.5：用药集合变化后重跑生效集合检查并随响应返回（PRD §7.3.5 / §7.8.2；恢复计划是最易漏的入口）。
 * 只标注不阻止：暂停/结束后剩余集合的命中照常返回，由前端决定是否展示。
 */
export async function patchPlan(userId: string, id: string, input: PlanPatch) {
  const existing = await plansRepo.findPlan(userId, id)
  if (!existing) return undefined
  const row = await plansRepo.updatePlan(userId, id, compact({ ...input }))
  if (!row) return undefined
  const { interactions } = await checkActiveInteractions(userId)
  return { plan: toPlanDto(row), interactions }
}

export async function deletePlan(userId: string, id: string): Promise<boolean> {
  const existing = await plansRepo.findPlan(userId, id)
  if (!existing) return false
  await recordsRepo.deleteRecordsByPlanIds(userId, [id])
  return plansRepo.deletePlan(userId, id)
}
