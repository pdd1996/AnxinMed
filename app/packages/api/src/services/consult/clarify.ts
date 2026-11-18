/**
 * 对象澄清（M13-P1 · docs/14 §4 T4；specs/17 T3）——纯函数，零 I/O，确定性。
 *
 * 目的：用户没绑定咨询对象、但问题明显在问「某种药」（这个药/它/该药/说明书…）时，
 * 不再回一句「未关联药箱药品」的 no-source 固定文案，而是问「你想问药箱里的哪种药？」
 * 并给出药名选项（点选后带 drugId 重问）。
 *
 * 纪律（裁决 A3）：
 * - 只做「对象药缺失」一种澄清，不泛化追问；
 * - **零 LLM**：固定文案 + 药箱药名选项；不写库、不进 risk_events；
 * - 用户药箱为空时不澄清（走既有 no-source 引导去录入）；
 * - 只在 routeSkill 判为 S1 且无绑定药后调用（S2 数据问题不经过本层）。
 */

import type { ConsultClarifyOption } from '@anxin/shared'
import type { ConsultRunResult, NormalizedSections } from './types.js'

/** 药箱候选行（结构性参数，避免纯函数依赖 repo/DB 类型）。 */
export interface ClarifyDrugCandidate {
  id: string
  genericName: string
  brandName: string | null
}

/** 选项上限（老年用户一屏可点选；超出部分提示回药箱查看）。 */
export const CLARIFY_OPTION_MAX = 6

/**
 * 指代 / 说明书信号：说明用户在问「某种药」，但没有绑定对象。
 * 刻意不匹配「布洛芬能一起吃吗」这类点名具体药品的问题（对象不在药箱，应走 no-source/建议卡）。
 */
export const CLARIFY_SIGNAL_PATTERN =
  /(?:这个|那个|这种|该)(?:药|片|胶囊|颗粒|滴眼液|喷雾|软膏)|(?:这个|那个)(?:能|可以|还有|怎么|要|是不是)|它(?:有|能|会|要|该|怎么|的)|说明书/

/** 是否需要对象澄清（纯函数）。 */
export function shouldClarifyObject(question: string): boolean {
  return CLARIFY_SIGNAL_PATTERN.test(String(question ?? ''))
}

/** 药箱行 → 去重、限量的药名选项（保持 repo 传入顺序：新建档在前）。 */
export function buildClarifyOptions(drugs: ClarifyDrugCandidate[]): ConsultClarifyOption[] {
  const seen = new Set<string>()
  const options: ConsultClarifyOption[] = []
  for (const d of drugs) {
    const drugName = d.brandName ? `${d.genericName}（${d.brandName}）` : d.genericName
    if (seen.has(drugName)) continue
    seen.add(drugName)
    options.push({ drugId: d.id, drugName })
    if (options.length >= CLARIFY_OPTION_MAX) break
  }
  return options
}

/** 澄清固定回答（不调模型、不引用说明书）。 */
export function buildClarifySections(): NormalizedSections {
  return {
    summary: '你想问药箱里的哪种药？',
    keyPoints: [
      '点选下面的药名，我会按该药的说明书回答。',
      '也可以回到药箱，从该药的「问这个药」进入。',
    ],
    risks: [],
    nextAction: '点选一种药继续提问。',
    warning: '我只基于本地说明书库解释已确认药品的资料。',
    limited: false,
  }
}

/** 澄清结果（service 层统一落库/返回；带药名选项）。 */
export function buildClarifyResult(options: ConsultClarifyOption[]): ConsultRunResult {
  return {
    riskLevel: 'L1',
    status: 'clarify',
    answer: buildClarifySections().summary,
    sections: buildClarifySections(),
    citations: [],
    notice: null,
    l0Notice: null,
    blocked: false,
    matchedKeyword: null,
    triggerDrugId: null,
    clarifyOptions: options,
  }
}
