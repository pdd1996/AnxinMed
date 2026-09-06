/**
 * 规则引擎 · 相互作用检查（M2-T5 · PRD §7.8.2 / §8.2）——`checkInteractions`。
 *
 * 检查对象是**生效计划的集合**（status=active、时间窗与今日重叠的药品），不是药箱库存——
 * 药箱是仓库，计划才是在服。对 `interaction_rules.drugIds` 做集合匹配：规则的每个药都在生效集合内才命中。
 * 命中按四级分级排序（禁忌 > 慎用 > 需监测 > 注意）；未覆盖时返回明确 coverageNote（**未覆盖 ≠ 无风险**）。
 *
 * 纯函数：规则库与药名映射由调用方（plans.service 经 assets.repo）传入，本函数不碰 DB。
 * 条目内容只能抄录（PRD §7.8.1）——本函数只匹配既有规则，绝不生成 note/source。
 */
import { INTERACTION_LEVEL_ORDER, type InteractionLevel } from '@anxin/shared'

/** 相互作用规则（interaction_rules 行的匹配所需形态）。 */
export interface InteractionRuleInput {
  id: string
  drugIds: string[] // → drug_master.id[]
  level: InteractionLevel
  note: string
  source: string
}

/** 命中项：分级 + 说明 + 来源 + 涉及药品（id 与名称）。 */
export interface InteractionHit {
  level: InteractionLevel
  note: string
  source: string
  drugIds: string[]
  drugNames: string[]
}

export interface InteractionResult {
  /** 命中的相互作用（按分级降序）。 */
  hits: InteractionHit[]
  /** 生效集合 ≥2 药但无规则命中时的安全提示（未覆盖 ≠ 无风险）；否则 null。 */
  coverageNote: string | null
}

/** 未覆盖提示文案（PRD §7.8.2：提示不阻止、不自动改方案，引导咨询医生/药师）。 */
export const INTERACTION_COVERAGE_NOTE =
  '当前药品组合未被相互作用规则库覆盖 ≠ 无风险，联用前请咨询医生或药师'

/**
 * 相互作用集合匹配。
 * @param drugMasterIds 生效计划集合的 drug_master.id（含即将新建的药）；手动建档药无 masterId 已被排除
 * @param rules         interaction_rules 全量（或按相关药预筛）
 * @param drugNameById  drug_master.id → 通用名（用于命中项展示；缺失回退为 id）
 */
export function checkInteractions(
  drugMasterIds: string[],
  rules: InteractionRuleInput[],
  drugNameById: Record<string, string> = {},
): InteractionResult {
  const set = new Set((drugMasterIds ?? []).filter(Boolean))
  // 单药 / 无药：没有「组合」可检，不算未覆盖（不给出误导性的安全提示）
  if (set.size < 2) return { hits: [], coverageNote: null }

  const hits: InteractionHit[] = []
  for (const rule of rules ?? []) {
    const ids = rule.drugIds ?? []
    // 规则的每个药都必须在生效集合内（≥2 药才构成相互作用）
    if (ids.length >= 2 && ids.every((id) => set.has(id))) {
      hits.push({
        level: rule.level,
        note: rule.note,
        source: rule.source,
        drugIds: ids,
        drugNames: ids.map((id) => drugNameById[id] ?? id),
      })
    }
  }
  hits.sort((a, b) => INTERACTION_LEVEL_ORDER[b.level] - INTERACTION_LEVEL_ORDER[a.level])

  return { hits, coverageNote: hits.length === 0 ? INTERACTION_COVERAGE_NOTE : null }
}
