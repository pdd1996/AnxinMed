/**
 * 咨询意图路由（AI 药师「意图路由 + 只读查询工具」· 计划 T2）——纯函数，零 I/O，确定性。
 *
 * 设计决策（计划文档「架构决策」）：
 * 1. 纯正则关键词白名单（与 patterns.ts 的 SECTION_ROUTES 同构），不做 LLM 意图分类：
 *    Baichuan 实测不支持 function calling（tools 参数返回 HTTP 400），最小输出单次调用
 *    5.2s（内置 reasoning + 医疗文献 grounding）——「每次 LLM 意图分类」的延迟不可接受。
 * 2. 宁漏勿误：漏判 = 走现有说明书管线 = 行为与今天一致（安全）；误判 = 模板答非所问
 *    （无医学风险但体验差）。因此**解释类词优先仲裁**：问题命中说明书段落词汇时返回
 *    null 走现有管线（如「我的药有哪些副作用」不得误路由到数据查询模板）。
 * 3. 扩展位：未来可加 `AiClients.classifyIntent?` 二级分类（输出必须过 zod 校验才能
 *    参与路由决策），以 consult_logs 留痕的漏判数据为启用依据；如未来需原生工具调用
 *    可切 DashScope Qwen 端点（QWEN_API_KEY 已在 .env，Qwen 支持 tools）。
 *
 * ⚠️ 纪律（与 patterns.ts 迁移纪律同款）：新增关键词必须先在单测里加对应口语变体，
 *    避免"看起来在路由但实际漏"。
 */

/** 数据查询意图（4 值；service 层命中后走 dataquery.ts 的 runDataQuery 只读工具直查库）。 */
export type QueryIntent = 'medication-list' | 'adherence' | 'expiry-stock' | 'interaction-check'

/**
 * 解释类问题仲裁正则：问题命中这些"说明书词汇"时优先走现有说明书管线（返回 null）。
 * 词汇来源 = patterns.ts SECTION_ROUTES 各段落路由的关键词，两处裁剪 + 一处保留：
 * - 裁剪 interactions 条目的「一起|联用|同时|搭配|共同」——与 interaction-check 查询词
 *   天然重叠，若进仲裁表会让联用查询意图永远不可达；防误路由由 interaction-check 正则
 *   自身的「冲突/风险」上下文约束兜底（「能和其他药一起吃吗」不含冲突词 → 不命中）；
 * - 裁剪 storage 条目的单字「存」——「库存」是 expiry-stock 查询词，单字会误杀；
 * - 保留「相互作用」（说明书标准术语）——「这个药一起吃有什么相互作用」类说明书问题
 *   宁可漏判（走现有管线，行为不变）也不误路由到模板。
 *
 * 导出：医生端 ask 意图路由（insight/askIntent.ts）复用同一份仲裁表（宁漏勿误单一真相）。
 */
export const EXPLAIN_INTENT_PATTERN =
  /药理|机制|原理|机理|起效|怎么作用|为什么有效|不良|副作用|反应|不适|禁忌|不能|过敏|成分|辅料|含有|含什么|注意|事项|小心|保存|储存|存放|相互作用|怎么吃|怎么用|用法|用量|吃几|用几|频次/

/**
 * 查询意图路由表（同构 SECTION_ROUTES 风格；按数组顺序短路匹配）。
 * 顺序即优先级（特异者在前）：
 *   interaction-check（要求双词共现，最特异）→ expiry-stock → adherence
 *   → medication-list（「药箱里有什么」最泛，殿后防止截胡更具体的意图，
 *   如「有什么药快过期了」须归 expiry-stock 而非清单）。
 */
export const INTENT_ROUTES: ReadonlyArray<{
  intent: QueryIntent
  re: RegExp
  label: string
}> = [
  {
    intent: 'interaction-check',
    re: /一起吃.{0,8}(冲突|相互作用)|搭配.{0,6}风险/,
    label: '在服药品相互作用检查',
  },
  { intent: 'expiry-stock', re: /过期|临期|快用完|还剩多少|库存/, label: '效期与库存状态' },
  { intent: 'adherence', re: /依从|漏服|按时吃|执行率/, label: '近 30 天依从性统计' },
  {
    intent: 'medication-list',
    re: /多少.{0,4}(种)?药|几种药|药箱.{0,6}(有|剩|还有)|还有什么药|用药清单|正在吃?哪些?药/,
    label: '药箱用药清单',
  },
]

/**
 * 咨询意图分类（纯函数）：命中查询意图返回之；否则 null（= 走现有说明书管线）。
 * @param question 用户提问（service 层传脱敏后文本）
 * @remarks 本函数只管意图，不做守门——L4/L3 检测（guards.ts）在 service 层先于本函数
 *          执行；「我还有多少药，想停药」类混合句在本函数如实返回查询意图，实际运行
 *          由守门优先原则走 L3 拒答。
 */
export function classifyConsultIntent(question: string): QueryIntent | null {
  const q = String(question ?? '')
  // 1. 解释类词仲裁：说明书段落问题优先走现有管线（宁漏勿误）
  if (EXPLAIN_INTENT_PATTERN.test(q)) return null
  // 2. 查询意图按表短路匹配（先命中先返回）
  for (const route of INTENT_ROUTES) {
    if (route.re.test(q)) return route.intent
  }
  return null
}
