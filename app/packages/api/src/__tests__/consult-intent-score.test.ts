/**
 * T6 意图候选打分单测（M13-P2 · docs/14 §4 T6）。
 *
 * 覆盖：
 * - 候选固定覆盖 5 个数据意图、分数 0–100、reason 不含问题原文；
 * - 低置信判定：top<80 / top2 差≤8 / 解释或行动类仲裁触发；
 * - **零行为变更**：候选观测字段不改变 resolveSkillRoute 的决策（与既有 route 测试同口径）。
 */
import { describe, expect, it } from 'vitest'
import {
  classifyIntentConfidence,
  scoreIntentCandidates,
  type ConsultIntentCandidate,
} from '../services/consult/intent.js'
import { resolveSkillRoute } from '../services/consult/registry.js'

function top(candidates: ConsultIntentCandidate[]): ConsultIntentCandidate {
  return [...candidates].sort((a, b) => b.score - a.score)[0]
}

describe('scoreIntentCandidates · 候选打分（只观测）', () => {
  it('固定覆盖 5 个数据意图，分数 0–100，reason 为空或标签串', () => {
    const candidates = scoreIntentCandidates('我现在有多少药物')
    expect(candidates.map((c) => c.intent).sort()).toEqual([
      'adherence',
      'expiry-stock',
      'interaction-check',
      'medication-list',
      'next-dose',
    ])
    for (const c of candidates) {
      expect(c.score).toBeGreaterThanOrEqual(0)
      expect(c.score).toBeLessThanOrEqual(100)
      expect(c.reason).not.toContain('多少药物')
    }
  })

  it('强 S2 问法：top 分 ≥80（不低置信）', () => {
    const candidates = scoreIntentCandidates('我现在有多少种药')
    expect(top(candidates).intent).toBe('medication-list')
    expect(top(candidates).score).toBeGreaterThanOrEqual(80)
    expect(classifyIntentConfidence(candidates, null).lowConfidence).toBe(false)
  })

  it('解释类仲裁触发 → 低置信（veto:explain）', () => {
    const candidates = scoreIntentCandidates('这个药有什么副作用')
    const confidence = classifyIntentConfidence(candidates, 'explain')
    expect(confidence.lowConfidence).toBe(true)
    expect(confidence.reason).toBe('veto:explain')
  })

  it('行动类仲裁触发 → 低置信（veto:advice）', () => {
    const candidates = scoreIntentCandidates('药过期了还能吃吗')
    const confidence = classifyIntentConfidence(candidates, 'advice')
    expect(confidence.lowConfidence).toBe(true)
    expect(confidence.reason).toBe('veto:advice')
  })

  it('候选分数接近（top2 差 ≤8）→ 低置信（margin）', () => {
    const candidates = scoreIntentCandidates('药箱里的药还有几片')
    const confidence = classifyIntentConfidence(candidates, null)
    expect(confidence.lowConfidence).toBe(true)
    expect(confidence.reason).toBe('margin')
    expect(confidence.top - confidence.second).toBeLessThanOrEqual(8)
  })

  it('无任何线索 → 低置信（top-low）', () => {
    const candidates = scoreIntentCandidates('最近总睡不好')
    const confidence = classifyIntentConfidence(candidates, null)
    expect(confidence.lowConfidence).toBe(true)
    expect(confidence.reason).toBe('top-low')
  })
})

describe('T6 · 决策 parity（观测不改变路由）', () => {
  it('候选打分不改变既有决策：S1 / S2 / S0 / skillId 与既有语义一致', () => {
    const guard = resolveSkillRoute({ question: '我胸痛', intentRouteEnabled: true })
    expect(guard.decision.skill).toBe('S0')
    expect(guard.decision).toMatchObject({ skill: 'S0', kind: 'emergency' })
    expect(
      resolveSkillRoute({ question: '这个药有什么副作用', intentRouteEnabled: true }).decision,
    ).toEqual({ skill: 'S1' })
    expect(
      resolveSkillRoute({ question: '我现在有多少药物', intentRouteEnabled: true }).decision,
    ).toEqual({ skill: 'S2', intent: 'medication-list' })
    expect(
      resolveSkillRoute({ question: '今天吃啥呀', intentRouteEnabled: true, skillId: 's2-next-dose' }).decision,
    ).toEqual({ skill: 'S2', intent: 'next-dose' })
  })

  it('margin 场景：决策仍按既有短路（expiry-stock），候选分仅记录', () => {
    const resolution = resolveSkillRoute({ question: '药箱里的药还有几片', intentRouteEnabled: true })
    expect(resolution.decision).toEqual({ skill: 'S2', intent: 'expiry-stock' })
    expect(resolution.lowConfidence).toBe(true)
  })

  it('S0 与 skillId 快路径：不做低置信判定（候选为空、lowConfidence=false）', () => {
    const guard = resolveSkillRoute({ question: '我胸痛', intentRouteEnabled: true })
    expect(guard.intentCandidates).toEqual([])
    expect(guard.lowConfidence).toBe(false)
    expect(guard.lowConfidenceReason).toBeNull()

    const fast = resolveSkillRoute({ question: '今天吃啥呀', intentRouteEnabled: true, skillId: 's2-next-dose' })
    expect(fast.intentCandidates).toEqual([])
    expect(fast.lowConfidence).toBe(false)
  })

  it('意图路由开关关闭：不产生候选观测（决策 S1）', () => {
    const resolution = resolveSkillRoute({ question: '我现在有多少药物', intentRouteEnabled: false })
    expect(resolution.decision).toEqual({ skill: 'S1' })
    expect(resolution.intentCandidates).toEqual([])
    expect(resolution.lowConfidence).toBe(false)
  })
})
