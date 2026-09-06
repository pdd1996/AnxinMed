/**
 * 规则引擎 · 说明书范围校验（M2-T5 · PRD §8.3）——`checkDosageRange`。
 *
 * 计划草稿生成后、确认页展示前，对照说明书库 `dosage` 结构化数字（maxFrequencyPerDay / dosePerUse）
 * 校验频次与单次用量；超范围项**仅标注留痕，绝不阻止创建**（PRD §8.3：不根据药名自动生成剂量，
 * 系统保存的是用户确认的医嘱抄录/自填）。参照 demo/server/index.js `rangeCheck`。
 *
 * 纯函数：说明书由调用方（plans.service 经 assets.repo）传入，本函数不碰 DB。
 */

/** 剂量 { value, unit }（与 shared DoseSchema 同构）。 */
export interface DoseValue {
  value: number
  unit: string
}

/** 说明书 dosage.adult 结构化数字（规则引擎锚点）。 */
export interface DosageAdult {
  route?: string | null
  usual?: string | null
  frequencyPerDay?: number | null
  dosePerUse?: DoseValue | null
  maxFrequencyPerDay?: { value: number; unit: string; note?: string | null } | null
}

/** 范围校验所需的说明书切片。 */
export interface PackageInsertDosage {
  dosage?: { adult?: DosageAdult | null } | null
  source?: string | null
  version?: string | null
}

/** 待校验的计划草稿（只用到剂量与频次）。 */
export interface PlanDraftDosage {
  dose?: DoseValue | null
  frequency?: number | null
}

/** 超范围项：哪个字段、计划值、说明书上限、留痕说明。 */
export interface DosageRangeIssue {
  field: 'frequency' | 'dosePerUse'
  planValue: string
  insertMax: string
  insertNote: string
}

export interface DosageRangeResult {
  /** pass=未超范围；exceed=有超范围项（仅标注）；none=说明书无结构化用法用量，跳过。 */
  status: 'pass' | 'exceed' | 'none'
  issues: DosageRangeIssue[]
  note?: string
  /** 依据来源（说明书 source · version），供确认页展示可追溯。 */
  basis?: string
}

/**
 * 说明书范围校验（纯函数，只标注不阻止）。
 * @param planDraft     计划草稿（dose + frequency）
 * @param packageInsert 该药的说明书切片（无则 status='none'）
 */
export function checkDosageRange(
  planDraft: PlanDraftDosage,
  packageInsert?: PackageInsertDosage | null,
): DosageRangeResult {
  const adult = packageInsert?.dosage?.adult
  if (!adult) {
    return { status: 'none', issues: [], note: '说明书库未收录该药品的结构化用法用量，跳过范围校验' }
  }

  const issues: DosageRangeIssue[] = []

  // 频次上限：计划频次 > 说明书最大频次/日 → 标注（> 才算超，等于上限不超）
  const max = adult.maxFrequencyPerDay
  if (max && planDraft.frequency != null && planDraft.frequency > max.value) {
    issues.push({
      field: 'frequency',
      planValue: `${planDraft.frequency} 次/日`,
      insertMax: `${max.value} ${max.unit}/日`,
      insertNote: max.note ?? '超出说明书最大频次，请核对医嘱',
    })
  }

  // 单次用量：仅同单位可比（单位不同不猜换算）；计划单次 > 说明书常规单次 → 标注
  const usual = adult.dosePerUse
  if (usual && planDraft.dose && planDraft.dose.unit === usual.unit && planDraft.dose.value > usual.value) {
    issues.push({
      field: 'dosePerUse',
      planValue: `${planDraft.dose.value} ${planDraft.dose.unit}`,
      insertMax: `${usual.value} ${usual.unit}`,
      insertNote: '单次用量超过说明书常规，请核对医嘱原文',
    })
  }

  const basis = [packageInsert?.source, packageInsert?.version].filter(Boolean).join(' · ')
  return { status: issues.length > 0 ? 'exceed' : 'pass', issues, basis: basis || undefined }
}
