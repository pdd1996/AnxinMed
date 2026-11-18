/**
 * 咨询意图评测集回归（M13-T1 · docs/14 §4 T1；specs/16 T1）——fixture 入 CI。
 *
 * 断言：
 * - fixture 规模 ≥120、id 唯一、每条有期望路由；
 * - 全部已实现用例通过（pendingUntil=P1 的 clarify / out-of-scope 用例跳过）；
 * - 守门用例（S0）全部被拦截（守卫优先于意图路由的静态保证）。
 *
 * 失败时 vitest 会打印「id: 期望/实际」明细（evaluateIntentCases.summary.failures）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { IntentEvalFileSchema, evaluateIntentCases } from '../services/consult/intent-eval.js'

const FIXTURE_PATH = fileURLToPath(new URL('../../../../fixtures/consult-intent-eval.json', import.meta.url))
const cases = IntentEvalFileSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as unknown)

describe('consult-intent-eval · 意图评测集回归', () => {
  it('fixture 规模 ≥120、id 唯一、每条有期望路由', () => {
    expect(cases.length).toBeGreaterThanOrEqual(120)
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
    for (const c of cases) {
      expect(c.expectedRoute, `${c.id} 缺期望路由`).toBeTruthy()
    }
  })

  it('覆盖守门 / S2 五意图 / S1 / P1 clarify + out-of-scope（无 pending）', () => {
    const routes = new Set(cases.map((c) => c.expectedRoute))
    for (const expected of [
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
    ]) {
      expect(routes.has(expected as never), `缺少 ${expected} 用例`).toBe(true)
    }
    expect(cases.filter((c) => c.pendingUntil).length).toBe(0)
  })

  it('全部用例通过（P1 层已启用，0 失败 / 0 待启用）', () => {
    const { summary } = evaluateIntentCases(cases)
    const failures = summary.failures.map((f) => `${f.id}「${f.question}」${f.failure ?? ''}`)
    expect(failures).toEqual([])
    expect(summary.failed).toBe(0)
    expect(summary.pending).toBe(0)
    expect(summary.passed).toBe(cases.length)
  })

  it('守门用例（S0）全部被拦截且优先于意图路由', () => {
    const guardCases = cases.filter((c) => c.expectedRoute.startsWith('S0/') && !c.pendingUntil)
    expect(guardCases.length).toBeGreaterThanOrEqual(20)
    const { results } = evaluateIntentCases(guardCases)
    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([])
  })
})
