/**
 * 咨询意图路由（AI 药师「意图路由 + 只读查询工具」· 计划 T2 / M13-T3）——纯函数，零 I/O，确定性。
 *
 * 设计决策（计划文档「架构决策」）：
 * 1. 纯正则关键词白名单（与 patterns.ts 的 SECTION_ROUTES 同构），不做 LLM 意图分类：
 *    Baichuan 实测不支持 function calling（tools 参数返回 HTTP 400），最小输出单次调用
 *    5.2s（内置 reasoning + 医疗文献 grounding）——「每次 LLM 意图分类」的延迟不可接受。
 * 2. 宁漏勿误：漏判 = 走现有说明书管线 = 行为与今天一致（安全）；误判 = 模板答非所问
 *    （无医学风险但体验差）。因此**解释类词 / 行动建议类词优先仲裁**：问题命中说明书词汇
 *    或「还能吃吗 / 怎么办 / 要不要」这类行动问法时返回 null 走现有管线
 *    （如「我的药有哪些副作用」不得误路由到数据查询模板）。
 * 3. 扩展位：未来可加 `AiClients.classifyIntent?` 二级分类（输出必须过 zod 校验才能
 *    参与路由决策），以 consult_logs 留痕的漏判数据为启用依据（docs/14 §4 T8）。
 *
 * ⚠️ 纪律（与 patterns.ts 迁移纪律同款）：新增关键词必须先在单测里加对应口语变体，
 *    避免"看起来在路由但实际漏"。
 */

import type { ConsultQueryIntent } from '@anxin/shared'

/**
 * 数据查询意图（service 层命中后走 dataquery.ts 的 runDataQuery 只读工具直查库）。
 * 类型真相在 shared（M4-T1 契约收编：QuickQuestion.intent 与本表同源）；本文件持有正则本体。
 */
export type QueryIntent = ConsultQueryIntent

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
 * 咨询专用「行动 / 建议类」仲裁（M13-T3d · docs/14 §4 T3d）——问的是"能不能 / 怎么办"，
 * 不是在查药箱数据；命中 → S1（说明书画线），宁可漏判也不给数据模板。
 *
 * ⚠️ 刻意**不并入** EXPLAIN_INTENT_PATTERN：后者被医生端 insight/askIntent.ts 复用，
 *    医生问「怎么办」仍应按队列/患者问法走数据路由，不能因患者侧行动词仲裁而漏判。
 */
export const CONSULT_ADVICE_PATTERN =
  /还能(?:吃|用|喝|贴|服)|能不能(?:吃|用|喝|贴|服)|怎么办|要不要|该不该|正常吗|要紧吗|有没有事|严重吗|危害|后果|要补|补服|补吃/

/**
 * 查询意图路由表（同构 SECTION_ROUTES 风格；按数组顺序短路匹配）。
 * 顺序即优先级（特异者在前）：
 *   interaction-check（要求双词共现，最特异）→ expiry-stock → adherence
 *   → next-dose（「今天要吃」时间锚定，M4-T7 增补）
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
  {
    intent: 'expiry-stock',
    // M13-T3c：补口语库存变体（还有几片 / 还剩几颗 / 快吃完 / 剩多少）；
    // 刻意不含「还有多少」——「这个药还有多少」语义不明（数量？疗程？），宁漏勿误走 S1。
    re: /过期|临期|快用完|还剩多少|库存|还有几(?:片|颗|粒|支|盒)|还剩几(?:片|颗|粒|支|盒)|快吃完|剩多少/,
    label: '效期与库存状态',
  },
  { intent: 'adherence', re: /依从|漏服|按时吃|执行率/, label: '近 30 天依从性统计' },
  {
    intent: 'next-dose',
    re: /今天.{0,6}(该吃|要吃|吃什么|还吃)|今日待服/,
    label: '今日待服安排',
  },
  {
    intent: 'medication-list',
    re: /多少.{0,4}(种)?药|几种药|药箱.{0,6}(有|剩|还有)|还有什么药|用药清单|正在吃?哪些?药/,
    label: '药箱用药清单',
  },
]

/** 意图分析产物（供路由轨迹记录仲裁原因；classifyConsultIntent 只看 intent）。 */
export interface ConsultIntentAnalysis {
  /** 命中的数据查询意图；null = 走 S1。 */
  intent: QueryIntent | null
  /** 仲裁结果：命中解释类词 / 行动建议类词；null = 未仲裁。 */
  veto: 'explain' | 'advice' | null
  /** 命中的意图规则 label（供 trace）；null = 未命中或已被仲裁。 */
  matchedRule: string | null
}

/**
 * 咨询意图分析（纯函数）：解释类词仲裁 → 行动建议类仲裁 → 查询意图按表短路匹配。
 * @param question 用户提问（service 层传脱敏后文本）
 * @remarks 本函数只管意图，不做守门——L4/L3 检测（guards.ts）在 service 层先于本函数
 *          执行；「我还有多少药，想停药」类混合句在本函数如实返回查询意图，实际运行
 *          由守门优先原则走 L3 拒答。
 */
export function analyzeConsultIntent(question: string): ConsultIntentAnalysis {
  const q = String(question ?? '')
  // 1. 解释类词仲裁：说明书段落问题优先走现有管线（宁漏勿误）
  if (EXPLAIN_INTENT_PATTERN.test(q)) return { intent: null, veto: 'explain', matchedRule: null }
  // 2. 行动建议类仲裁（M13-T3d）：问「能不能吃 / 怎么办」不是查数据
  if (CONSULT_ADVICE_PATTERN.test(q)) return { intent: null, veto: 'advice', matchedRule: null }
  // 3. 查询意图按表短路匹配（先命中先返回）
  for (const route of INTENT_ROUTES) {
    if (route.re.test(q)) return { intent: route.intent, veto: null, matchedRule: route.label }
  }
  return { intent: null, veto: null, matchedRule: null }
}

/**
 * 咨询意图分类（纯函数）：命中查询意图返回之；否则 null（= 走现有说明书管线）。
 * @param question 用户提问（service 层传脱敏后文本）
 */
export function classifyConsultIntent(question: string): QueryIntent | null {
  return analyzeConsultIntent(question).intent
}

// ─────────────────────────────────────────────────────────────────────────────
// T6 意图候选打分（M13-P2 · docs/14 §4 T6）——**只观测，不参与决策**
//
// 决策仍由 analyzeConsultIntent 的「短路 + 解释/行动词仲裁」决定（逐字 parity）；
// 本段只产出候选 `{ intent, score, reason }` 与低置信标记，供 trace / 定向抽检使用。
// 打分尺度 0–100：规则命中给基础分 55，命中该意图的线索词再加权（25/15/5），封顶 100。
// 「低置信」= top < 80 或 top2 差 ≤ 8，或解释/行动类仲裁触发（这些样本最适合人工复看）。
// ─────────────────────────────────────────────────────────────────────────────

/** 低置信阈值（top 分低于此 → 低置信；对应 docs/14 §4 T6）。 */
export const LOW_CONFIDENCE_TOP_THRESHOLD = 80
/** 低置信阈值（top1 与 top2 分差 ≤ 此值 → 低置信）。 */
export const LOW_CONFIDENCE_MARGIN_THRESHOLD = 8

/** 单条候选（trace 落盘用；reason 只含记分项标签，不含问题原文）。 */
export interface ConsultIntentCandidate {
  intent: QueryIntent
  /** 0–100；只用于观测。 */
  score: number
  /** 命中线索标签（+ 连接）；未命中为「无命中」。 */
  reason: string
}

/** 低置信原因（定向抽检分组用）。 */
export type IntentConfidenceReason = 'veto:explain' | 'veto:advice' | 'top-low' | 'margin' | null

/**
 * 打分线索表：与 INTENT_ROUTES 同源但拆成加权线索。
 * 权重口径：规则命中基础 55；线索依次 25 / 15 / 5（合计 ≤45）。
 * 只用于候选分数，不参与路由决策。
 */
const INTENT_SCORE_CUES: Record<QueryIntent, ReadonlyArray<{ re: RegExp; weight: number; label: string }>> = {
  'interaction-check': [
    { re: /冲突|相互作用|相克/, weight: 25, label: '冲突/相互作用' },
    { re: /一起|同吃|同服|同时|搭配|联用/, weight: 15, label: '共现语境' },
    { re: /哪些药|这些药|多种药|在服|长期吃/, weight: 5, label: '多药语境' },
  ],
  'expiry-stock': [
    { re: /过期|临期|快用完|快吃完/, weight: 25, label: '效期/耗尽' },
    { re: /还剩|剩多少|还有几/, weight: 15, label: '剩余量问法' },
    { re: /库存|存药|囤药/, weight: 5, label: '库存语境' },
  ],
  adherence: [
    { re: /依从|按时吃|执行率/, weight: 25, label: '依从性术语' },
    { re: /漏服|漏吃|忘吃|没吃/, weight: 15, label: '漏服语境' },
    { re: /记录|统计|近期/, weight: 5, label: '统计语境' },
  ],
  'next-dose': [
    { re: /今天.{0,6}(该吃|要吃|吃什么|还吃)|今日待服/, weight: 25, label: '今日待服问法' },
    { re: /几点|什么时候吃|待服/, weight: 15, label: '时点问法' },
    { re: /吃药|服药/, weight: 5, label: '服药语境' },
  ],
  'medication-list': [
    { re: /多少.{0,4}(种)?药|几种药/, weight: 25, label: '数量问法' },
    { re: /药箱.{0,6}(有|剩|还有)|还有什么药|用药清单|正在吃?哪些?药/, weight: 15, label: '清单问法' },
    { re: /药物|药品|哪些药|什么药/, weight: 5, label: '泛指药物' },
  ],
}

/**
 * 意图候选打分（纯函数，零 I/O）：对 5 个数据意图各自打分，按 INTENT_ROUTES 顺序返回。
 * @param question 脱敏后文本
 * @remarks 决策不消费本函数（parity 由 analyzeConsultIntent 保证）；仅在 trace / 评测报告中使用。
 */
export function scoreIntentCandidates(question: string): ConsultIntentCandidate[] {
  const q = String(question ?? '')
  return INTENT_ROUTES.map((route) => {
    const base = route.re.test(q) ? 55 : 0
    const hits = INTENT_SCORE_CUES[route.intent].filter((cue) => cue.re.test(q))
    const bonus = Math.min(45, hits.reduce((sum, cue) => sum + cue.weight, 0))
    const reason = hits.length > 0 ? hits.map((hit) => hit.label).join('+') : base > 0 ? '规则命中' : '无命中'
    return { intent: route.intent, score: Math.min(100, base + bonus), reason }
  })
}

/**
 * 低置信判定（纯函数）：top < 80 / top2 差 ≤ 8 / 解释或行动类仲裁触发。
 * @param candidates scoreIntentCandidates 产物（可为空数组）
 * @param veto analyzeConsultIntent 的仲裁结果
 */
export function classifyIntentConfidence(
  candidates: ConsultIntentCandidate[],
  veto: 'explain' | 'advice' | null,
): { lowConfidence: boolean; reason: IntentConfidenceReason; top: number; second: number } {
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const top = sorted[0]?.score ?? 0
  const second = sorted[1]?.score ?? 0
  if (veto === 'explain') return { lowConfidence: true, reason: 'veto:explain', top, second }
  if (veto === 'advice') return { lowConfidence: true, reason: 'veto:advice', top, second }
  // top2 接近优先归类为 margin（比 top-low 更有指导性）；second=0 时归 top-low（无竞争候选）
  if (second > 0 && top - second <= LOW_CONFIDENCE_MARGIN_THRESHOLD) {
    return { lowConfidence: true, reason: 'margin', top, second }
  }
  if (top < LOW_CONFIDENCE_TOP_THRESHOLD) return { lowConfidence: true, reason: 'top-low', top, second }
  return { lowConfidence: false, reason: null, top, second }
}
