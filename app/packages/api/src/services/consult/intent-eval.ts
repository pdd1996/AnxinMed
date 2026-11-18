/**
 * 咨询意图评测集（M13-T1 · docs/14 §4 T1；specs/16 T1）——fixture schema + 评测纯函数。
 *
 * 定位：把「意图漏判率」从每月 30 条人工抽检，升级为可回归的评测资产。
 * - route 级：`resolveSkillRoute`（纯函数）对比期望路由；
 * - section 级：S1 用例可用探针说明书切片验证 `pickInsertSections` 的段落键；
 * - P1 行为（clarify / out-of-scope）先以 `pendingUntil` 声明期望，不参与通过率；
 * - 输出逐条结果 + 混淆矩阵 + 按 tag 失败清单（供 `eval:intent` 与 CI 复用）。
 *
 * ⚠️ 纪律：fixture 每条 case 必须有期望；新增词表/仲裁必须先加 case（与 patterns.ts 同款纪律）。
 */

import { z } from 'zod'
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

/** 评测全部用例（纯函数：不读文件、不打日志，供 test/script 复用）。 */
export function evaluateIntentCases(cases: IntentEvalCase[]): {
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

    const resolution = resolveSkillRoute({
      question: c.question,
      intentRouteEnabled: true,
      skillId: null,
    })
    const actualRoute = formatSkillRoute(resolution.decision)
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
