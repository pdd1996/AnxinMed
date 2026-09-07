/**
 * AI 药师意图路由 · 意图分类纯函数单测（计划 T2）。
 *
 * 覆盖：
 * - classifyConsultIntent 正例 × 4 意图（每意图 ≥5 口语变体，逐条与 intent.ts 正则自验匹配）
 * - 负例回归：现有测试文件（consult-api / consult-guards / consult-sections / degradation /
 *   insight-api）出现的全部问题文本逐一断言 null（不命中任何查询意图）
 * - 歧义句 × 3（说明书问题不得误路由）
 * - 仲裁行为固化：解释词优先（「药箱里有什么注意事项」→ null）、「相互作用」走说明书管线
 * - 混合句：「我还有多少药，想把 XX 停了」→ medication-list（函数只管意图，守门在 service 层）
 *
 * = 55 case（正例 22 + 负例回归 27 + 歧义/仲裁/混合 6）。
 */
import { describe, it, expect } from 'vitest'
import { classifyConsultIntent } from '../services/consult/intent.js'

// ---------------------------------------------------------------------------
// 正例：每意图 ≥5 口语变体（逐条与 INTENT_ROUTES 正则自验匹配）
// ---------------------------------------------------------------------------

describe('classifyConsultIntent · medication-list 正例', () => {
  const cases = [
    '我现在有多少药物', // 多少.{0,4}(种)?药 →「多少」+「药」
    '我现在有几种药', // 几种药
    '药箱里还有什么药', // 药箱.{0,6}(有|剩|还有) + 还有什么药
    '我的用药清单发我看看', // 用药清单
    '我正在吃哪些药', // 正在吃?哪些?药
    '药箱里还有别的药吗', // 药箱.{0,6}(还有)
  ]
  for (const q of cases) {
    it(`「${q}」→ medication-list`, () => {
      expect(classifyConsultIntent(q)).toBe('medication-list')
    })
  }
})

describe('classifyConsultIntent · adherence 正例', () => {
  const cases = [
    '我的依从性怎么样', // 依从
    '最近老漏服怎么办的记录', // 漏服
    '我按时吃药了吗', // 按时吃
    '这个月执行率多少', // 执行率（adherence 先于 medication-list，「多少」句尾无「药」不截胡）
    '我最近总忘记按时吃药', // 按时吃
  ]
  for (const q of cases) {
    it(`「${q}」→ adherence`, () => {
      expect(classifyConsultIntent(q)).toBe('adherence')
    })
  }
})

describe('classifyConsultIntent · expiry-stock 正例', () => {
  const cases = [
    '有什么药快过期了', // 过期（expiry-stock 先于 medication-list，不被「有什么药」截胡）
    '我的药有快用完的吗', // 快用完
    '阿司匹林还剩多少', // 还剩多少
    '帮我看看药品库存', // 库存（单字「存」已从仲裁表裁剪，不误杀）
    '哪些药快临期了', // 临期
  ]
  for (const q of cases) {
    it(`「${q}」→ expiry-stock`, () => {
      expect(classifyConsultIntent(q)).toBe('expiry-stock')
    })
  }
})

describe('classifyConsultIntent · interaction-check 正例', () => {
  const cases = [
    '我的药一起吃有冲突吗', // 一起吃.{0,8}冲突
    '这些药一起吃会冲突吗', // 一起吃 + 会 + 冲突
    '我在吃的药搭配有风险吗', // 搭配.{0,6}风险
    '降压药和降糖药一起吃起冲突吗', // 一起吃 + 起 + 冲突
    '我的药一起吃会不会冲突', // 一起吃 + 会不会 + 冲突
    '这几种药搭配在一起风险大吗', // 搭配 + 在一起 + 风险（interaction-check 先于 medication-list「几种药」）
  ]
  for (const q of cases) {
    it(`「${q}」→ interaction-check`, () => {
      expect(classifyConsultIntent(q)).toBe('interaction-check')
    })
  }
})

// ---------------------------------------------------------------------------
// 负例回归：现有测试文件出现的全部问题文本逐一断言 null
// （来源：consult-api / consult-guards / consult-sections / degradation / insight-api）
// ---------------------------------------------------------------------------

describe('classifyConsultIntent · 负例回归（现有测试问题文本不命中）', () => {
  const negatives = [
    // consult-api.test.ts
    '这个药通常用于什么？',
    '我胸痛得厉害，怎么办',
    '这个药能不能停', // 「不能」→ 解释词仲裁
    '这个药通常用于什么',
    '这个药怎么用', // 「怎么用」→ 解释词仲裁
    '我的手机号是13812345678，这个药通常用于什么？',
    '', // 空串
    // consult-guards.test.ts
    '我胸痛得厉害',
    '突然呼吸困难',
    '家里儿童误服了降压药怎么办',
    '我想自杀',
    '能不能停药', // 「不能」→ 解释词仲裁
    '把这个药停了行不行',
    '我应该吃几片', // 「吃几」→ 解释词仲裁
    '能不能换成别的药', // 「不能」→ 解释词仲裁
    '这个药的不良反应有哪些', // 「不良」→ 解释词仲裁
    '我胸痛，能不能停药',
    '我胸痛',
    // consult-sections.test.ts
    '这个药是怎么作用的', // 「怎么作用」→ 解释词仲裁
    '能和其他药一起吃吗', // 「一起吃吗」无冲突词 → interaction-check 不命中
    '有什么副作用', // 「副作用」→ 解释词仲裁
    '哪些人不能用', // 「不能」→ 解释词仲裁
    '含有什么成分', // 「含有」「成分」→ 解释词仲裁
    '有什么注意事项', // 「注意」「事项」→ 解释词仲裁
    '怎么保存', // 「保存」→ 解释词仲裁
    '应该怎么吃', // 「怎么吃」→ 解释词仲裁
    '这个药的药理机制是什么', // 「药理」「机制」→ 解释词仲裁
    // degradation.test.ts（'这个药通常用于什么'）/ insight-api.test.ts（'我胸痛'）
    // 的问题文本已与上方 consult-api / consult-guards 段重合，不再重复列出
  ]
  for (const q of negatives) {
    it(`「${q || '(空串)'}」→ null`, () => {
      expect(classifyConsultIntent(q)).toBeNull()
    })
  }
})

// ---------------------------------------------------------------------------
// 歧义句 + 仲裁行为固化 + 混合句
// ---------------------------------------------------------------------------

describe('classifyConsultIntent · 歧义句与仲裁优先级', () => {
  it('歧义句「这个药有哪些副作用」→ null（解释词优先，不得误路由）', () => {
    expect(classifyConsultIntent('这个药有哪些副作用')).toBeNull()
  })

  it('歧义句「这个药怎么保存」→ null（解释词优先）', () => {
    expect(classifyConsultIntent('这个药怎么保存')).toBeNull()
  })

  it('歧义句「这个药还有多少」→ null（「还有多少」句尾无「药」，不命中清单；非「还剩多少」）', () => {
    expect(classifyConsultIntent('这个药还有多少')).toBeNull()
  })

  it('仲裁固化「药箱里有什么注意事项」→ null（含清单词但解释词「注意/事项」优先）', () => {
    expect(classifyConsultIntent('药箱里有什么注意事项')).toBeNull()
  })

  it('仲裁固化「我的药一起吃有相互作用吗」→ null（「相互作用」为说明书术语，宁漏勿误走现有管线）', () => {
    expect(classifyConsultIntent('我的药一起吃有相互作用吗')).toBeNull()
  })

  it('混合句「我还有多少药，想把阿司匹林停了」→ medication-list（函数只管意图；L3「想停」守门在 service 层先于意图，实际运行走 refused）', () => {
    expect(classifyConsultIntent('我还有多少药，想把阿司匹林停了')).toBe('medication-list')
  })
})
