/**
 * 用药安全汇总 / 入箱预检（V2.5 · PRD §7.8.2「主动干预」）—— 两处共用同一检查对象「生效计划集合」：
 *
 * - GET /api/safety：首页/药箱常驻安全卡的当前在服组合汇总（0 次 LLM，复用 checkInteractions）；
 * - 入箱预检：新药 × 当前生效计划集合，草稿确认（无计划路径）与手动建档后返回——
 *   「加入一种药时就和在服的药比对一次」，不等用户建完计划才提示。
 *
 * 边界（不变）：
 * - 条目内容只能抄录（PRD §7.8.1），本服务只匹配既有规则，绝不生成 note/source；
 * - 未覆盖 ≠ 无风险：无命中时由 coverageNote + 规则库统计明示覆盖范围；
 * - 在服但未关联标准药品库的药（手动建档）无法参与 drug_master 规则匹配，用 skippedDrugNames
 *   诚实披露，不静默当作「已检查」。
 */
import * as assetsRepo from '../repositories/assets.repo.js'
import {
  checkActiveInteractions,
  countRuleLibrary,
  resolveActiveMedications,
  toInteractionRuleInputs,
  type RuleLibraryStats,
} from './plans.service.js'
import { checkInteractions, type InteractionResult } from './rules/index.js'

/** GET /api/safety 响应体（患者端常驻安全卡消费；0 次 LLM）。
 * 用 type 别名（非 interface）：满足 okJson 的 Record<string, unknown> 约束。 */
export type SafetySummaryView = {
  /** 生效计划集合的相互作用命中（四级分级 + 来源 + 规则状态）。 */
  interactions: InteractionResult
  /** 今日时间窗内生效计划数（UI 判断「当前没有在服药品」用）。 */
  activePlanCount: number
  /** 参与比对的在服药品通用名（已关联标准药品库）。 */
  checkedDrugNames: string[]
  /** 在服但无法参与比对的药（手动建档无 drug_master.id），UI 必须可见。 */
  skippedDrugNames: string[]
  /** 规则库规模与状态分布（UI 诚实披露：演示条目不得冒充正式库）。 */
  ruleLibrary: RuleLibraryStats
  checkedAt: string
}

/**
 * 入箱预检结果（新药 × 生效计划集合）。
 * checked：已比对（hits 可能为空，此时 coverageNote 说明未覆盖）；
 * unavailable：结构上无法比对（手动建档无标准库身份 / 当前没有生效计划）——必须明确告知，不假装查过。
 */
export type AddInteractionPrecheck =
  | {
      status: 'checked'
      interactions: InteractionResult
      activePlanCount: number
      skippedDrugNames: string[]
      ruleLibrary: RuleLibraryStats
    }
  | {
      status: 'unavailable'
      reason: 'manual' | 'no-active-plans'
      activePlanCount: number
      message: string
    }

/** 首页/药箱常驻安全卡：当前生效集合的相互作用汇总（只读，0 次 LLM）。 */
export async function getSafetySummary(userId: string): Promise<SafetySummaryView> {
  const { interactions, snapshot, ruleLibrary } = await checkActiveInteractions(userId)
  return {
    interactions,
    activePlanCount: snapshot.activePlanCount,
    checkedDrugNames: snapshot.checkedDrugNames,
    skippedDrugNames: snapshot.skippedDrugNames,
    ruleLibrary,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * 入箱预检：拿「刚加入药箱的新药」与当前生效计划集合比一次（PRD §7.8.2 时机零，V2.5 新增）。
 * @param newDrugMasterId 新药的 drug_master.id；手动建档为 null（结构上无法参与规则匹配）
 */
export async function getAddInteractionPrecheck(
  userId: string,
  newDrugMasterId: string | null,
): Promise<AddInteractionPrecheck> {
  const snapshot = await resolveActiveMedications(userId)

  if (!newDrugMasterId) {
    return {
      status: 'unavailable',
      reason: 'manual',
      activePlanCount: snapshot.activePlanCount,
      message:
        '该药为手动建档，未关联标准药品库，无法自动核对与其他在服药品的相互作用；请以医生或药师意见为准',
    }
  }

  if (snapshot.activePlanCount === 0) {
    return {
      status: 'unavailable',
      reason: 'no-active-plans',
      activePlanCount: 0,
      message: '当前没有生效计划，暂无可比对的在服药品',
    }
  }

  const ruleRows = await assetsRepo.listInteractionRules()
  const masterIds = [...new Set([...snapshot.activeMasterIds, newDrugMasterId])]
  const names = await assetsRepo.findDrugMasterNames(masterIds)
  const interactions = checkInteractions(masterIds, toInteractionRuleInputs(ruleRows), names)

  return {
    status: 'checked',
    interactions,
    activePlanCount: snapshot.activePlanCount,
    skippedDrugNames: snapshot.skippedDrugNames,
    ruleLibrary: countRuleLibrary(ruleRows),
  }
}
