/**
 * 咨询范围层纯函数单测（M13-P1 · docs/14 §4 T5；specs/17 T2）。
 *
 * 覆盖：
 * - 诊断请求 × 6 口语变体 → diagnosis-request；
 * - 明显非用药话题 × 6 → non-medication；
 * - 正常用药问题（含「这个药能治什么病」这类易误杀句）→ medication（默认放行）；
 * - 固定文案分支：诊断/非用药各自的 sections 与 out-of-scope 结果形态（L1、不 blocked）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildOutOfScopeResult,
  buildOutOfScopeSections,
  classifyConsultScope,
} from '../services/consult/scope.js'

describe('classifyConsultScope · 诊断请求（不诊断，走 out-of-scope）', () => {
  const cases = [
    '我是不是得了糖尿病',
    '我这是怎么了',
    '我这是什么病',
    '帮我看看这个检查报告是不是癌症',
    '体检报告怎么看',
    '诊断一下我这个情况',
  ]
  for (const q of cases) {
    it(`「${q}」→ diagnosis-request`, () => {
      expect(classifyConsultScope(q)).toBe('diagnosis-request')
    })
  }
})

describe('classifyConsultScope · 明显非用药话题', () => {
  const cases = [
    '股票买哪个',
    '帮我写个劳动合同',
    '今天天气怎么样',
    '帮我订一张去上海的机票',
    '给我讲个笑话',
    '帮我写一段 Python 代码',
  ]
  for (const q of cases) {
    it(`「${q}」→ non-medication`, () => {
      expect(classifyConsultScope(q)).toBe('non-medication')
    })
  }
})

describe('classifyConsultScope · 正常用药问题（默认放行，不误杀）', () => {
  const cases = [
    '这个药通常用于什么',
    '这个药能治什么病',
    '这个药是不是治高血压的',
    '这个药能喝酒吗',
    '吃药后胃不舒服',
    '我最近有点头晕',
    '我想停药',
    '这个药对肝功能有影响吗',
    '漏服了怎么办',
    '帮我看看这个药的不良反应',
  ]
  for (const q of cases) {
    it(`「${q}」→ medication`, () => {
      expect(classifyConsultScope(q)).toBe('medication')
    })
  }
})

describe('out-of-scope 固定文案与结果形态', () => {
  it('诊断请求 → 明确「不能诊断/解读报告」+ 建议就医，不含具体用药建议', () => {
    const s = buildOutOfScopeSections('diagnosis-request')
    expect(s.summary).toContain('不能做诊断')
    expect(s.summary).toContain('检查报告')
    expect(s.nextAction).toContain('医生')
    expect(s.warning).toContain('不能诊断')
  })

  it('非用药话题 → 说明能力范围（说明书 + 药箱数据）', () => {
    const s = buildOutOfScopeSections('non-medication')
    expect(s.summary).toContain('服务范围')
    expect(s.keyPoints.join('')).toContain('说明书')
    expect(s.keyPoints.join('')).toContain('药箱')
  })

  it('buildOutOfScopeResult → L1 / out-of-scope / 不 blocked / 无 citations / 无关系药', () => {
    const r = buildOutOfScopeResult('non-medication')
    expect(r.riskLevel).toBe('L1')
    expect(r.status).toBe('out-of-scope')
    expect(r.blocked).toBe(false)
    expect(r.citations).toEqual([])
    expect(r.triggerDrugId).toBeNull()
  })
})
