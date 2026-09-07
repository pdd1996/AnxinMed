/**
 * 数据查询工具与模板（AI 药师「意图路由 + 只读查询工具」· 计划 T3）——`runDataQuery`。
 *
 * 职责：按 QueryIntent 确定性编排（0 次 LLM 调用），复用 insight.repo 三只读函数 +
 *   service 层请求内已取数的相互作用上下文，模板渲染 NormalizedSections 后统一返回
 *   status='data-answered' 的 ConsultRunResult：
 *
 *   medication-list   → insight.repo.getMedicationList   药箱用药清单
 *   adherence         → insight.repo.getAdherenceStats   近 30 天依从性统计
 *   expiry-stock      → insight.repo.getExpiryStatus     效期/临期/低库存
 *   interaction-check → rules.checkInteractions          在服组合相互作用（service 层已取数，避免重复查库）
 *
 * ⚠️ 编排纪律（计划文档「架构决策」）：
 * - 模板直接产出 NormalizedSections，**不经** normalizeSections/stripDosageAdvice：
 *   统计数字（如「执行率 85%」「库存剩余 3 片」）会被 L2 剂量正则（DOSAGE_OUTPUT_PATTERN）
 *   误杀；模板自身禁止出现「每次 X 片」类剂量/用法表述，只陈述库存量与统计事实。
 * - DB 异常不捕获：直接抛给上层 app.onError（500 + 统一错误码，失败可见不静默），
 *   也不降级到 LLM 生成（LLM 无数据必然幻觉）。
 * - interactionRules / activeMasterIds / drugNameById 由 service 层请求内共享传入
 *   （与 consult.service.ts:135-165 的同名变量天然衔接，避免重复查库）。
 */
import {
  getAdherenceStats,
  getExpiryStatus,
  getMedicationList,
  type AdherenceStats,
  type ExpiryStatus,
  type MedicationItem,
} from '../../repositories/insight.repo.js'
import {
  checkInteractions,
  INTERACTION_COVERAGE_NOTE,
  type InteractionResult,
  type InteractionRuleInput,
} from '../rules/index.js'
import { dbCitation } from './citations.js'
import type { QueryIntent } from './intent.js'
import type { ConsultRunResult, NormalizedSections } from './types.js'

// ---------------------------------------------------------------------------
// 输入类型（service 层组装：意图 + 用户 + 请求内已取数的相互作用上下文）
// ---------------------------------------------------------------------------

/**
 * runDataQuery 输入。
 * activeMasterIds / interactionRules / drugNameById 与 consult.service.ts:135-165 的
 * 同名变量天然衔接（service 层已为 runConsult 取好，数据查询路径直接复用，避免重复查库）。
 */
export interface DataQueryInput {
  userId: string
  intent: QueryIntent
  /** 生效计划集合的 drug_master.id（interaction-check 用）。 */
  activeMasterIds: string[]
  /** 相互作用规则（service 层已从 assets.repo 取好，请求内共享）。 */
  interactionRules: InteractionRuleInput[]
  /** drug_master.id → 通用名（命中项展示）。 */
  drugNameById: Record<string, string>
}

// ---------------------------------------------------------------------------
// 固定文案
// ---------------------------------------------------------------------------

/** 数据查询回答的统一安全语（模板路径 warning；不含剂量/用法表述）。 */
const DATA_QUERY_WARNING = '以上为你的建档数据，用药请遵医嘱；如需调整用药请咨询医生或药师。'

/** 药箱清单 keyPoints 上限（超出给汇总行，避免回答过长）。 */
const MAX_LIST_POINTS = 10

// ---------------------------------------------------------------------------
// 模板渲染纯函数（4 个意图各一；完整 NormalizedSections，空数据给友好固定文案）
// ---------------------------------------------------------------------------

/** 药品描述行：通用名 +（商品名 · 规格 · 剂型），可空项跳过。 */
function describeMed(m: MedicationItem): string {
  const extras = [m.brandName, m.specification, m.form].filter(Boolean).join(' · ')
  return extras ? `${m.genericName}（${extras}）` : m.genericName
}

/** medication-list 模板：药箱用药清单。 */
export function renderMedicationListSections(meds: MedicationItem[]): NormalizedSections {
  if (meds.length === 0) {
    return {
      summary: '你的药箱目前没有建档药品。',
      keyPoints: ['可在「药箱」页手动建档，或通过拍照处方/药盒录入建立档案。'],
      risks: [],
      nextAction: '前往「药箱」页面添加药品后即可查询。',
      warning: DATA_QUERY_WARNING,
      limited: false,
    }
  }
  const keyPoints = meds.slice(0, MAX_LIST_POINTS).map((m, i) => `${i + 1}. ${describeMed(m)}`)
  if (meds.length > MAX_LIST_POINTS) {
    keyPoints.push(`……及其他 ${meds.length - MAX_LIST_POINTS} 种药品`)
  }
  return {
    summary: `你的药箱目前共建档 ${meds.length} 种药品。`,
    keyPoints,
    risks: [],
    nextAction: '前往「药箱」页面可查看、补充或更新药品信息。',
    warning: DATA_QUERY_WARNING,
    limited: false,
  }
}

/** adherence 模板：近 N 天依从性统计（执行率/漏服/连续漏服；不给补救剂量建议）。 */
export function renderAdherenceSections(stats: AdherenceStats): NormalizedSections {
  if (stats.total === 0) {
    return {
      summary: `近 ${stats.dateRange} 天还没有服药打卡记录。`,
      keyPoints: ['在「今日」页面按时打卡后，这里会为你统计执行率与漏服情况。'],
      risks: [],
      nextAction: '前往「今日」页面查看今天的服药任务。',
      warning: DATA_QUERY_WARNING,
      limited: false,
    }
  }
  const keyPoints = [
    `应服 ${stats.total} 次，已按时完成 ${stats.taken} 次`,
    `漏服 ${stats.skipped} 次`,
    `最近连续漏服 ${stats.consecutiveSkip} 次`,
  ]
  // skipDetails 的 drugId 实为 planId（insight.repo MVP 简化），仅展示日期不展示 id
  const skipDates = [...new Set(stats.skipDetails.map((d) => d.date))].slice(0, 3)
  if (skipDates.length > 0) {
    keyPoints.push(`最近漏服日期：${skipDates.join('、')}`)
  }
  const risks: string[] = []
  if (stats.consecutiveSkip >= 2) {
    risks.push(
      `已连续漏服 ${stats.consecutiveSkip} 次，请关注；漏服后不要自行加倍补服，处理方式请咨询医生或药师。`,
    )
  }
  if (stats.rate < 80) {
    risks.push(`执行率 ${stats.rate}% 偏低，漏服可能影响疗效；改善困难请与医生沟通。`)
  }
  return {
    summary: `近 ${stats.dateRange} 天服药执行率约 ${stats.rate}%（完成 ${stats.taken}/${stats.total} 次）。`,
    keyPoints,
    risks,
    nextAction: '前往「今日」页面按时打卡；漏服后的补救请咨询医生或药师。',
    warning: DATA_QUERY_WARNING,
    limited: false,
  }
}

/** expiry-stock 模板：效期/临期/低库存分类（只陈述库存量，不给服用建议）。 */
export function renderExpiryStockSections(status: ExpiryStatus): NormalizedSections {
  const { expiring, expired, lowStock } = status
  if (expiring.length === 0 && expired.length === 0 && lowStock.length === 0) {
    return {
      summary: '暂无过期、30 天内到期或库存不足的药品提醒。',
      keyPoints: ['药品效期与库存为建档快照，请以实际包装为准。'],
      risks: [],
      nextAction: '可定期回来看看，临近到期或库存不足时会在这里提醒。',
      warning: DATA_QUERY_WARNING,
      limited: false,
    }
  }
  const keyPoints: string[] = []
  for (const m of expired) {
    keyPoints.push(`${m.genericName} 已过期 ${-m.days} 天`)
  }
  for (const m of expiring) {
    keyPoints.push(m.days === 0 ? `${m.genericName} 今天到期` : `${m.genericName} 约 ${m.days} 天后到期`)
  }
  for (const m of lowStock) {
    const stock = m.stock ? `（库存剩余 ${m.stock.value} ${m.stock.unit}）` : ''
    keyPoints.push(`${m.genericName} 库存不足${stock}`)
  }
  const risks: string[] = []
  if (expired.length > 0) {
    risks.push('过期药品请勿继续服用，请按药品说明书或药师指导处理。')
  }
  if (expiring.length > 0) {
    risks.push('临期药品请确认能否在效期内用完，不确定时咨询药师。')
  }
  const parts: string[] = []
  if (expired.length > 0) parts.push(`${expired.length} 种已过期`)
  if (expiring.length > 0) parts.push(`${expiring.length} 种 30 天内到期`)
  if (lowStock.length > 0) parts.push(`${lowStock.length} 种库存不足`)
  return {
    summary: `你的药箱有 ${parts.join('、')}的药品。`,
    keyPoints,
    risks,
    nextAction: '前往「药箱」页面处理过期/临期药品并补充库存。',
    warning: DATA_QUERY_WARNING,
    limited: false,
  }
}

/** interaction-check 模板：在服组合相互作用检查（复用 checkInteractions 纯函数结果）。 */
export function renderInteractionsSections(
  result: InteractionResult,
  activeMasterIds: string[],
): NormalizedSections {
  const activeCount = activeMasterIds.length
  if (activeCount === 0) {
    return {
      summary: '当前没有生效中的用药计划，暂不构成联用组合。',
      keyPoints: ['生效计划（在服药品）≥ 2 种时才会做联用相互作用检查。'],
      risks: [],
      nextAction: '前往「药箱」页面查看在服药品；如需联用请咨询医生或药师。',
      warning: DATA_QUERY_WARNING,
      limited: false,
    }
  }
  if (activeCount === 1) {
    return {
      summary: '当前生效计划中只有 1 种药品，暂不构成联用组合。',
      keyPoints: ['相互作用检查需要 ≥ 2 种在服药品。'],
      risks: [],
      nextAction: '前往「药箱」页面查看在服药品；如需联用请咨询医生或药师。',
      warning: DATA_QUERY_WARNING,
      limited: false,
    }
  }
  if (result.hits.length > 0) {
    return {
      summary: `当前在服药品组合检出 ${result.hits.length} 项相互作用提示。`,
      keyPoints: result.hits.map(
        (h) => `[${h.level}] ${h.drugNames.join(' + ')}：${h.note}（来源：${h.source}）`,
      ),
      risks: ['存在相互作用提示时请勿自行停药或换药，请携带用药清单咨询医生或药师。'],
      nextAction: '请将上述提示告知医生或药师，由其评估是否调整方案。',
      warning: DATA_QUERY_WARNING,
      limited: false,
    }
  }
  // ≥2 药但无规则命中：coverageNote 非空（未覆盖 ≠ 无风险）
  return {
    summary: '当前在服药品组合未检出已知相互作用。',
    keyPoints: [result.coverageNote ?? INTERACTION_COVERAGE_NOTE],
    risks: ['规则库覆盖有限，未检出不等于无风险。'],
    nextAction: '联用前如有疑虑，请咨询医生或药师。',
    warning: DATA_QUERY_WARNING,
    limited: false,
  }
}

// ---------------------------------------------------------------------------
// 编排主入口
// ---------------------------------------------------------------------------

/** answer 组装：summary + 关键要点（参考 run.ts emergency 分支的「summary + 补充」模式）。 */
function buildAnswer(sections: NormalizedSections): string {
  if (sections.keyPoints.length === 0) return sections.summary
  return [sections.summary, ...sections.keyPoints].join('\n')
}

/**
 * 数据查询编排主入口（纯 I/O 编排；模板渲染为纯函数）。
 * DB 异常不捕获——直接抛给上层 app.onError（失败可见不静默，不降级 LLM）。
 * @returns ConsultRunResult（status='data-answered'，riskLevel='L1'，blocked=false，含 toolUsed）
 */
export async function runDataQuery(input: DataQueryInput): Promise<ConsultRunResult> {
  const { userId, intent, activeMasterIds, interactionRules, drugNameById } = input
  let sections: NormalizedSections

  switch (intent) {
    case 'medication-list': {
      const meds = await getMedicationList(userId)
      sections = renderMedicationListSections(meds)
      break
    }
    case 'adherence': {
      const stats = await getAdherenceStats(userId)
      sections = renderAdherenceSections(stats)
      break
    }
    case 'expiry-stock': {
      const status = await getExpiryStatus(userId)
      sections = renderExpiryStockSections(status)
      break
    }
    case 'interaction-check': {
      // 纯函数：规则与药名映射由 service 层传入，本层不查库
      const result = checkInteractions(activeMasterIds, interactionRules, drugNameById)
      sections = renderInteractionsSections(result, activeMasterIds)
      break
    }
  }

  return {
    riskLevel: 'L1',
    status: 'data-answered',
    answer: buildAnswer(sections),
    sections,
    citations: [dbCitation(new Date())],
    notice: null,
    l0Notice: null,
    blocked: false,
    matchedKeyword: null,
    triggerDrugId: null,
    toolUsed: intent,
  }
}
