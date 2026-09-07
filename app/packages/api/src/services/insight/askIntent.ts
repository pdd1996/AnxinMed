/**
 * 医生端队列意图路由（T7.4 · ADR #17 第 2 条）——纯函数，零 I/O，确定性。
 *
 * 设计决策（沿用 consult/intent.ts 纪律，医生问法比患者口语规范，命中率更高）：
 * 1. 纯正则关键词白名单为主路径：固定问法 0 次 LLM 直查库（队列三工具）；
 *    漏判 = 长尾走百川叙述（队列摘要既有模式，数字全部来自工具计算结果）——安全，
 *    只是延迟高；误判 = 模板答非所问（无医学风险但体验差）。故宁漏勿误。
 * 2. 解释类词仲裁复用 consult/intent.ts 的 EXPLAIN_INTENT_PATTERN（单一真相）：
 *    「这些药有什么副作用」类说明书问题绝不误路由到队列统计模板。
 * 3. 新增关键词必须先在单测里补口语变体（spec §T7.4 硬要求，intent.ts 同款纪律）；
 *    golden 固定问法 ≥6 条（分布/差档队列/事件聚合各 2，E2E 红线断言 0 次 LLM）。
 * 4. 扩展位（本期不实现，ADR #17 第 2 条）：正则漏判长尾的 Qwen function calling 兜底——
 *    届时以 QUEUE_TOOLS 注册表导出 JSON Schema 供 DashScope tools，tool_call 参数仍过
 *    safeParse 执行；留痕（insight_ask_logs.intent 为空）即漏判率数据，作为启用依据。
 */

import { EXPLAIN_INTENT_PATTERN } from '../consult/intent.js'

/** 队列查询意图（3 值，对齐 QUEUE_TOOLS 注册表；service 层命中后 0 次 LLM 直查库）。 */
export type QueueIntent = 'adherence-distribution' | 'poor-cohort' | 'risk-events'

/**
 * 队列意图路由表（按数组顺序短路匹配，特异者在前）：
 *   poor-cohort（点名差档患者，要求「差/不好」+ 名单语义共现，最特异）
 *   → risk-events（事件/拦截/紧急信号）
 *   → adherence-distribution（分布/统计/各档人数，最泛殿后）。
 */
export const QUEUE_INTENT_ROUTES: ReadonlyArray<{
  intent: QueueIntent
  re: RegExp
  label: string
}> = [
  {
    intent: 'poor-cohort',
    re: /依从性差|执行率差|依从性不好|执行率不好|差的?(患者|人群|名单|有哪些)|哪些.{0,3}(患者|人).{0,4}(漏服|不按时|需要随访)|随访名单/,
    label: '执行率差的患者名单',
  },
  {
    intent: 'risk-events',
    re: /风险事件|拦截|紧急信号|急救|时间线|最近谁?(触发|出过).{0,4}(事|警)/,
    label: '风险事件聚合',
  },
  {
    intent: 'adherence-distribution',
    re: /依从性|执行率|分档|(优|中|差).{0,4}(各|分布)|多少.{0,3}(人|患者)/,
    label: '依从性分档分布',
  },
]

/**
 * 队列意图分类（纯函数）：命中返回 QueueIntent；否则 null（= 长尾，走 LLM 叙述路径）。
 * @param question 医生提问（service 层传脱敏后文本）
 * @remarks 只管意图不做守门——医生端无患者侧 L4/L3 提问拦截（医生是紧急情况的处置方），
 *          LLM 输出侧统一过 guardSummary（stripDosageAdvice + L4/L3 固定文案）。
 */
export function classifyQueueIntent(question: string): QueueIntent | null {
  const q = String(question ?? '')
  if (EXPLAIN_INTENT_PATTERN.test(q)) return null // 解释类仲裁：宁可漏判不误路由
  for (const route of QUEUE_INTENT_ROUTES) {
    if (route.re.test(q)) return route.intent
  }
  return null
}

/** 固定问法示例（响应 suggestions 字段；前端快捷 chip + 「能查的是这些」引导）。 */
export const ASK_SUGGESTIONS: ReadonlyArray<{ scope: 'queue' | 'patient'; text: string }> = [
  { scope: 'queue', text: '依从性分布怎么样？' },
  { scope: 'queue', text: '执行率差的患者有哪些？' },
  { scope: 'queue', text: '最近的风险事件汇总' },
  { scope: 'patient', text: '他最近依从性怎么样？' },
  { scope: 'patient', text: '药箱里还有什么药？' },
  { scope: 'patient', text: '有哪些药快过期了？' },
]
