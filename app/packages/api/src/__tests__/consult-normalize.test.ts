/**
 * T7 语义归一化路由视图单测（M13-P2 · docs/14 §4 T7）。
 *
 * 边界断言：
 * - 字符级（NFKC/空白折叠）与语义同义词只影响「路由视图」；
 * - 开关关闭时完全等价于旧行为（含字符级回滚）；
 * - 决策变化只发生在预期口语样本上，守门优先级不被绕过；
 * - 对象判定（clarify 指代信号）同样吃归一化视图。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { shouldClarifyObject } from '../services/consult/clarify.js'
import {
  ROUTE_NORMALIZE_FLAG,
  buildRoutingView,
  normalizeChars,
  normalizeRoutingText,
} from '../services/consult/normalize.js'
import { resolveSkillRoute } from '../services/consult/registry.js'

const originalFlag = process.env[ROUTE_NORMALIZE_FLAG]
afterEach(() => {
  if (originalFlag === undefined) delete process.env[ROUTE_NORMALIZE_FLAG]
  else process.env[ROUTE_NORMALIZE_FLAG] = originalFlag
})

describe('normalizeChars · 字符级归一', () => {
  it('NFKC：全角字母数字/标点转半角，全角空格折叠为单空格', () => {
    expect(normalizeChars('ＡＢＣ１２３')).toBe('ABC123')
    expect(normalizeChars('还剩　　几片')).toBe('还剩 几片')
    expect(normalizeChars('  药快过期了  ')).toBe('药快过期了')
  })
})

describe('buildRoutingView · 语义同义词（默认开）', () => {
  it('库存/效期口语 → 规范词', () => {
    expect(normalizeRoutingText('药快吃没了')).toContain('快用完')
    expect(normalizeRoutingText('药快见底了')).toContain('快用完')
    expect(normalizeRoutingText('药剩不多了')).toContain('快用完')
    expect(normalizeRoutingText('还剩几天的药')).toContain('还剩多少')
  })

  it('漏服/清单口语 → 规范词', () => {
    expect(normalizeRoutingText('老是忘吃药')).toContain('漏服')
    expect(normalizeRoutingText('漏吃药了')).toContain('漏服')
    expect(normalizeRoutingText('我都有哪些药')).toContain('正在吃哪些药')
    expect(normalizeRoutingText('吃的药有哪些')).toContain('正在吃哪些药')
  })

  it('指代变体 → 这个药（仅路由/对象判定）', () => {
    expect(normalizeRoutingText('这药有什么副作用')).toContain('这个药')
    expect(normalizeRoutingText('此药怎么吃')).toContain('这个药')
    // 已规范写法保持不变
    expect(normalizeRoutingText('这个药有什么副作用')).toBe('这个药有什么副作用')
  })

  it('幂等：重复归一不再变化', () => {
    const once = normalizeRoutingText('药快吃没了，老是忘吃药')
    expect(normalizeRoutingText(once)).toBe(once)
  })

  it('开关关闭：返回原始文本（字符级也回滚，可直接对比旧行为）', () => {
    process.env[ROUTE_NORMALIZE_FLAG] = 'false'
    const view = buildRoutingView('胸　痛，这药快吃没了')
    expect(view.text).toBe('胸　痛，这药快吃没了')
    expect(view.changed).toBe(false)
  })
})

describe('T7 · 路由决策变化（评测集背书的预期行为）', () => {
  const cases: Array<{ question: string; expected: string }> = [
    { question: '药快吃没了', expected: 'S2/expiry-stock' },
    { question: '药快见底了', expected: 'S2/expiry-stock' },
    { question: '还剩几天的药', expected: 'S2/expiry-stock' },
    { question: '药剩不多了', expected: 'S2/expiry-stock' },
    { question: '老是忘吃药', expected: 'S2/adherence' },
    { question: '漏吃药了', expected: 'S2/adherence' },
    { question: '我都有哪些药', expected: 'S2/medication-list' },
    { question: '吃的药有哪些', expected: 'S2/medication-list' },
  ]

  it('开关开：口语样本命中预期 S2 路由', () => {
    delete process.env[ROUTE_NORMALIZE_FLAG]
    for (const c of cases) {
      const { decision } = resolveSkillRoute({ question: c.question, intentRouteEnabled: true })
      expect(`${decision.skill}${decision.skill === 'S2' ? `/${decision.intent}` : ''}`, c.question).toBe(
        c.expected,
      )
    }
  })

  it('开关关：这些样本回退 S1（证明行为变化来自归一化、可一键回滚）', () => {
    process.env[ROUTE_NORMALIZE_FLAG] = 'false'
    for (const c of cases) {
      const { decision } = resolveSkillRoute({ question: c.question, intentRouteEnabled: true })
      expect(decision.skill, c.question).toBe('S1')
    }
  })

  it('对象判定：指代变体在归一化后命中 clarify 信号（无绑定药时）', () => {
    delete process.env[ROUTE_NORMALIZE_FLAG]
    expect(shouldClarifyObject(normalizeRoutingText('这药有什么副作用'))).toBe(true)
    expect(shouldClarifyObject(normalizeRoutingText('此药怎么吃'))).toBe(true)
    process.env[ROUTE_NORMALIZE_FLAG] = 'false'
    expect(shouldClarifyObject(normalizeRoutingText('这药有什么副作用'))).toBe(false)
  })

  it('守门优先：归一化不绕过 L4 红线', () => {
    delete process.env[ROUTE_NORMALIZE_FLAG]
    const { decision } = resolveSkillRoute({ question: '我胸痛，这药快吃没了', intentRouteEnabled: true })
    expect(decision.skill).toBe('S0')
  })
})
