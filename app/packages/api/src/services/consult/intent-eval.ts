/**
 * 咨询意图评测集（M13-T1 · docs/14 §4 T1；specs/16 T1）——fixture schema + 评测纯函数。
 *
 * 定位：把「意图漏判率」从每月 30 条人工抽检，升级为可回归的评测资产。
 * - route 级：`resolveSkillRoute`（纯函数）对比期望路由；
 * - P1 层（clarify / out-of-scope）：用 `classifyConsultScope` / `shouldClarifyObject` 纯函数
 *   与探针药箱验证（M13-P1 起启用，不再 pending）；
 * - section 级：S1 用例可用探针说明书切片验证 `pickInsertSections` 的段落键；
 * - 输出逐条结果 + 混淆矩阵 + 按 tag 失败清单（供 `eval:intent` 与 CI 复用）。
 *
 * ⚠️ 纪律：fixture 每条 case 必须有期望；新增词表/仲裁必须先加 case（与 patterns.ts 同款纪律）。
 */

import { z } from 'zod'
import type { ClarifyDrugCandidate } from './clarify.js'
import { shouldClarifyObject } from './clarify.js'
import type { IntentConfidenceReason } from './intent.js'
import { normalizeRoutingText } from './normalize.js'
import { classifyConsultScope } from './scope.js'
import type { InsertSlice } from './types.js'
import { pickInsertSections } from './sections.js'
import { formatSkillRoute, resolveSkillRoute } from './registry.js'

/** 期望路由取值（P1 的 clarify / out-of-scope 允许出现在 fixture，但须标 pendingUntil）。 */
export const INTENT_EVAL_ROUTES = [
  'S0/emergency',
  'S0/refused',
  'S2/medication-list',
  'S2/adherence',
  'S2/expiry-stock',
  'S2/interaction-check',
  'S2/next-dose',
  'S1',
  'clarify',
  'out-of-scope',
] as const

export type IntentEvalRoute = (typeof INTENT_EVAL_ROUTES)[number]

/** 评测用例（app/fixtures/consult-intent-eval.json 元素）。 */
export const IntentEvalCaseSchema = z.object({
  id: z.string().min(1),
  question: z.string(),
  /** 是否带对象药（当前 routeSkill 不消费；为 P1 的对象澄清/候选打分预留）。 */
  drugContext: z.enum(['bound', 'none']).default('bound'),
  expectedRoute: z.enum(INTENT_EVAL_ROUTES),
  /** S1 用例的期望说明书段落键（SECTION_ROUTES.key）。 */
  expectedSection: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
  /** P1 才实现的行为：标 `P1` 后本用例跳过（不参与通过率，但保留为规格）。 */
  pendingUntil: z.string().optional(),
  note: z.string().optional(),
})

export type IntentEvalCase = z.infer<typeof IntentEvalCaseSchema>

/** fixture 文件根（数组）。 */
export const IntentEvalFileSchema = z.array(IntentEvalCaseSchema)

/**
 * 段落路由探针说明书写片：只用于 `pickInsertSections` 的键判定（文本内容不参与断言）。
 * 所有字段填非空占位，避免「（未收录）」路径掩盖路由问题。
 */
const PROBE_INSERT: InsertSlice = {
  drugId: 'dm-eval-probe',
  genericName: '评测探针药',
  brandName: '探针',
  specification: '10mg',
  form: '片剂',
  indication: '用于评测探针适应症',
  components: '评测探针成份',
  dosage: { note: '评测探针用法' },
  contraindications: ['评测探针禁忌'],
  adverseReactions: '评测探针不良反应',
  precautions: ['评测探针注意事项'],
  interactions: '评测探针相互作用',
  pharmacology: '评测探针药理',
  pharmacokinetics: '评测探针药代',
  storage: '评测探针储存',
  source: '本地说明书库',
  version: 'eval-v1',
  sourceSections: {
    儿童用药: '评测探针儿童用药',
    老年用药: '评测探针老年用药',
    药物过量: '评测探针药物过量',
    孕妇和哺乳期妇女用药: '评测探针孕妇用药',
  },
  curationStatus: 'reviewed',
}

/** 对象澄清探针药箱（P1 层评测用：只要非空即可触发 clarify 分支）。 */
const PROBE_BOX: ClarifyDrugCandidate[] = [
  { id: 'drug-eval-probe-a', genericName: '评测探针药A', brandName: '探针' },
  { id: 'drug-eval-probe-b', genericName: '评测探针药B', brandName: null },
]

/** P1 层用例（clarify / out-of-scope）由范围/对象纯函数评测，不走 routeSkill。 */
function isP1Layer(c: IntentEvalCase): boolean {
  return c.expectedRoute === 'clarify' || c.expectedRoute === 'out-of-scope'
}

/** 评测 P1 层（范围优先于对象，与 service 层顺序一致；对象判定使用归一化路由视图，与线上一致）。 */
function evaluateP1Layer(question: string): string {
  if (classifyConsultScope(question) !== 'medication') return 'out-of-scope'
  if (shouldClarifyObject(normalizeRoutingText(question)) && PROBE_BOX.length > 0) return 'clarify'
  return 'S1'
}

/** 单条评测结果。 */
export interface IntentEvalResult {
  id: string
  question: string
  tags: string[]
  expectedRoute: IntentEvalRoute
  actualRoute: string | null
  expectedSection?: string
  actualSection?: string
  /** 已实现行为（非 pending）是否通过。 */
  ok: boolean
  /** P1 才落地的期望：跳过比较。 */
  pending: boolean
  failure?: string
}

export interface IntentEvalSummary {
  total: number
  passed: number
  failed: number
  pending: number
  /** 期望路由 → 实际路由 → 条数（pending 不计入）。 */
  confusion: Record<string, Record<string, number>>
  /** 失败用例（按 id 排序）。 */
  failures: IntentEvalResult[]
}

/** 评测全部用例（纯函数：不读文件、不打日志，供 test/script 复用）。 */export function evaluateIntentCases(cases: IntentEvalCase[]): {
  results: IntentEvalResult[]
  summary: IntentEvalSummary
} {
  const results: IntentEvalResult[] = []
  const confusion: Record<string, Record<string, number>> = {}

  for (const c of cases) {
    if (c.pendingUntil) {
      results.push({
        id: c.id,
        question: c.question,
        tags: c.tags,
        expectedRoute: c.expectedRoute,
        actualRoute: null,
        expectedSection: c.expectedSection,
        ok: false,
        pending: true,
        failure: `pendingUntil=${c.pendingUntil}（未实现，跳过比较）`,
      })
      continue
    }

    const resolution = isP1Layer(c)
      ? null
      : resolveSkillRoute({
          question: c.question,
          intentRouteEnabled: true,
          skillId: null,
        })
    const actualRoute = resolution ? formatSkillRoute(resolution.decision) : evaluateP1Layer(c.question)
    const routeOk = actualRoute === c.expectedRoute

    let actualSection: string | undefined
    let sectionOk = true
    if (c.expectedSection) {
      actualSection = pickInsertSections(c.question, PROBE_INSERT).key
      sectionOk = actualSection === c.expectedSection
    }

    const ok = routeOk && sectionOk
    const failureParts: string[] = []
    if (!routeOk) failureParts.push(`路由期望 ${c.expectedRoute}，实际 ${actualRoute}`)
    if (!sectionOk) failureParts.push(`段落期望 ${c.expectedSection}，实际 ${actualSection ?? '(未测)'}`)

    const bucket = (confusion[c.expectedRoute] ??= {})
    bucket[actualRoute] = (bucket[actualRoute] ?? 0) + 1

    results.push({
      id: c.id,
      question: c.question,
      tags: c.tags,
      expectedRoute: c.expectedRoute,
      actualRoute,
      expectedSection: c.expectedSection,
      actualSection,
      ok,
      pending: false,
      ...(ok ? {} : { failure: failureParts.join('；') }),
    })
  }

  const failures = results.filter((r) => !r.pending && !r.ok)
  return {
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => !r.pending && r.ok).length,
      failed: failures.length,
      pending: results.filter((r) => r.pending).length,
      confusion,
      failures,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// T6 低置信观测汇总（M13-P2 · docs/14 §4 T6）——只观测，不影响通过率。
// 统计范围：自由文本路由用例（期望 S1 或 S2/*）；S0 守门与 P1 clarify/out-of-scope 不参与。
// ─────────────────────────────────────────────────────────────────────────────

/** 低置信原因计数（不含 null）。 */
export type IntentLowConfidenceReasonCount = Record<NonNullable<IntentConfidenceReason>, number>

export interface IntentConfidenceSummary {
  /** 参与统计的用例数（期望 S1 或 S2/*，且非 pending）。 */
  evaluated: number
  lowConfidence: number
  highConfidence: number
  lowConfidenceRatio: number
  /** 低置信按原因拆分。 */
  reasons: IntentLowConfidenceReasonCount
  /** 按期望路由拆分（S1 / S2/*）：{ evaluated, lowConfidence }。 */
  byExpectedRoute: Record<string, { evaluated: number; lowConfidence: number }>
}

/**
 * 汇总评测集上的低置信分布（纯函数）：定向抽检与「规则缺口」判断的输入。
 * @remarks 用与线上完全相同的 resolveSkillRoute 观测字段；不做任何决策断言。
 */
export function summarizeIntentConfidence(cases: IntentEvalCase[]): IntentConfidenceSummary {
  const reasons: IntentLowConfidenceReasonCount = {
    'veto:explain': 0,
    'veto:advice': 0,
    'top-low': 0,
    margin: 0,
  }
  let evaluated = 0
  let lowConfidence = 0
  const byExpectedRoute: Record<string, { evaluated: number; lowConfidence: number }> = {}
  for (const c of cases) {
    if (c.pendingUntil) continue
    if (c.expectedRoute !== 'S1' && !c.expectedRoute.startsWith('S2/')) continue
    const resolution = resolveSkillRoute({
      question: c.question,
      intentRouteEnabled: true,
      skillId: null,
    })
    evaluated += 1
    const bucket = (byExpectedRoute[c.expectedRoute] ??= { evaluated: 0, lowConfidence: 0 })
    bucket.evaluated += 1
    if (!resolution.lowConfidence) continue
    lowConfidence += 1
    bucket.lowConfidence += 1
    if (resolution.lowConfidenceReason) reasons[resolution.lowConfidenceReason] += 1
  }
  return {
    evaluated,
    lowConfidence,
    highConfidence: evaluated - lowConfidence,
    lowConfidenceRatio: evaluated === 0 ? 0 : lowConfidence / evaluated,
    reasons,
    byExpectedRoute,
  }
}
