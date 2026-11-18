/**
 * 咨询范围判定（M13-P1 · docs/14 §4 T5；specs/17 T2）——纯函数，零 I/O，确定性。
 *
 * 目的：把「明显不是用药问题」的提问在进 S1 前挡掉，避免白花一次 LLM 调用，
 * 也避免让模型在说明书语境里硬答诊断/非用药问题。
 *
 * 纪律（裁决 A2/A4）：
 * - **纯规则、保守、默认放行**：只识别高置信的「诊断请求」与「明显非用药话题」；
 *   拿不准一律 `medication`（走既有 S1/S2，行为与 P0 一致）；
 * - **不接入模型**：拒绝/受理不应由模型决定；
 * - 诊断请求归 `out-of-scope`（产品边界），不并入 L3 安全拒答，也不进 risk_events；
 * - 只在 routeSkill 判为 S1 后调用；S0 守门永远在前，S2 数据问题不经过本层。
 */

import type { ConsultRunResult, NormalizedSections } from './types.js'

/** 范围判定三值（unknown 一律回落到 medication）。 */
export type ConsultScope = 'medication' | 'non-medication' | 'diagnosis-request'

/** out-of-scope 的两种固定文案分支。 */
export type OutOfScopeKind = Exclude<ConsultScope, 'medication'>

/**
 * 诊断 / 看报告 / 判断病情请求（保守正则）：
 * - 「我是不是得了糖尿病」「我这是怎么了」「我这是什么病」；
 * - 「帮我看看这个检查报告是不是癌症」「体检报告怎么看」；
 * - 「诊断一下 / 确诊一下」。
 * 刻意不匹配「这个药能治什么病」「这个药是不是治高血压的」等用药问题。
 */
export const DIAGNOSIS_REQUEST_PATTERN =
  /我(?:是不是|这是)(?:已经)?(?:得了|患了|患)[^，。！？]{0,12}|我(?:这|到底)(?:是)?(?:什么病|怎么了|咋了)|(?:帮我|给我|你)(?:看看?|判断|分析|解读|诊断).{0,12}(?:检查|化验|体检|报告|片子|结果)|(?:检查|化验|体检|报告单|化验单)(?:报告|单|结果)?.{0,12}(?:是不是|有没有|什么|严重|怎么看)|(?:诊断|确诊)一下/

/**
 * 明显非用药话题（保守白名单）：股票/基金/彩票/房产/劳动/代码/翻译/笑话/天气/机票。
 * 刻意不含「酒店/旅游/游戏」等可能与用药场景共现的词（如「旅游时药怎么保存」）。
 */
export const NON_MEDICATION_PATTERN =
  /股票|基金|炒股|彩票|买房|房价|劳动合同|劳动仲裁|写代码|编程|Python|JavaScript|TypeScript|翻译一下|帮我翻译|笑话|天气预报|今天天气|明天天气|天气怎么样|机票|订票/

/** 范围判定（纯函数）：诊断请求优先于非用药话题；其余一律用药域。 */
export function classifyConsultScope(question: string): ConsultScope {
  const q = String(question ?? '')
  if (DIAGNOSIS_REQUEST_PATTERN.test(q)) return 'diagnosis-request'
  if (NON_MEDICATION_PATTERN.test(q)) return 'non-medication'
  return 'medication'
}

/** out-of-scope 固定回答（不进模型、不引用说明书、不建议具体用药）。 */
export function buildOutOfScopeSections(kind: OutOfScopeKind): NormalizedSections {
  if (kind === 'diagnosis-request') {
    return {
      summary: '我不能做诊断，也不能解读检查报告。',
      keyPoints: [
        '判断病情需要医生结合症状、体征和检查结果。',
        '如果你担心自己的情况，建议尽快就医。',
      ],
      risks: [],
      nextAction: '请咨询医生或药师；如有突发不适，请立即就医或拨打急救电话。',
      warning: '我不能诊断疾病，也不能替代医生的判断。',
      limited: false,
    }
  }
  return {
    summary: '这个问题不在我的服务范围里。',
    keyPoints: [
      '我只做两件事：解释已确认药品的说明书资料，查询你的药箱数据。',
      '用药相关的问题，可以回到药箱选一种药再来问我。',
    ],
    risks: [],
    nextAction: '请换个用药相关的问题，或咨询医生、药师。',
    warning: '我不能提供与用药无关的服务，也不能替代医生或药师。',
    limited: false,
  }
}

/** out-of-scope 统一结果（L1、不 blocked、不进 risk_events）。 */
export function buildOutOfScopeResult(kind: OutOfScopeKind): ConsultRunResult {
  const sections = buildOutOfScopeSections(kind)
  return {
    riskLevel: 'L1',
    status: 'out-of-scope',
    answer: sections.summary,
    sections,
    citations: [],
    notice: null,
    l0Notice: null,
    blocked: false,
    matchedKeyword: null,
    triggerDrugId: null,
  }
}
