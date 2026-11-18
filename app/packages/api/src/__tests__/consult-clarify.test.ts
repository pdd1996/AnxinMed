/**
 * 对象澄清纯函数单测（M13-P1 · docs/14 §4 T4；specs/17 T3）。
 *
 * 覆盖：
 * - 指代/说明书信号 → 需要澄清（6 变体）；
 * - 点名具体药 / 普通数据问题 / 空串 → 不澄清（宁漏勿误）；
 * - 选项构造：商品名附带、去重、≤6、保持顺序；
 * - 澄清结果形态：status=clarify、带 clarifyOptions、不 blocked、无 citations。
 */
import { describe, expect, it } from 'vitest'
import {
  CLARIFY_OPTION_MAX,
  buildClarifyOptions,
  buildClarifyResult,
  shouldClarifyObject,
} from '../services/consult/clarify.js'

describe('shouldClarifyObject · 需要对象澄清', () => {
  const cases = [
    '这个药有什么副作用',
    '它怎么吃',
    '说明书上写的禁忌是什么',
    '这个药能喝酒吗',
    '帮我看看这个药的不良反应',
    '这个能吃吗',
  ]
  for (const q of cases) {
    it(`「${q}」→ true`, () => {
      expect(shouldClarifyObject(q)).toBe(true)
    })
  }
})

describe('shouldClarifyObject · 不澄清（宁漏勿误）', () => {
  const cases = [
    '布洛芬能一起吃吗', // 点名具体药（对象不在药箱）→ 走 no-source / 建议卡
    '我今天有点头晕',
    '我现在有多少药物', // S2 数据问题，不进本层
    '有什么副作用', // 无指代，无法确定对象
    '',
  ]
  for (const q of cases) {
    it(`「${q || '(空串)'}」→ false`, () => {
      expect(shouldClarifyObject(q)).toBe(false)
    })
  }
})

describe('buildClarifyOptions', () => {
  it('通用名 + 商品名展示、去重、保持入参顺序', () => {
    const options = buildClarifyOptions([
      { id: 'd1', genericName: '玻璃酸钠滴眼液', brandName: '海露' },
      { id: 'd2', genericName: '二甲双胍片', brandName: null },
      { id: 'd3', genericName: '玻璃酸钠滴眼液', brandName: '海露' },
    ])
    expect(options).toEqual([
      { drugId: 'd1', drugName: '玻璃酸钠滴眼液（海露）' },
      { drugId: 'd2', drugName: '二甲双胍片' },
    ])
  })

  it(`最多 ${CLARIFY_OPTION_MAX} 条`, () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      id: `d${i}`,
      genericName: `测试药${i}`,
      brandName: null,
    }))
    expect(buildClarifyOptions(rows)).toHaveLength(CLARIFY_OPTION_MAX)
  })

  it('空药箱 → 空选项（service 层回退 no-source）', () => {
    expect(buildClarifyOptions([])).toEqual([])
  })
})

describe('buildClarifyResult', () => {
  it('固定追问 + 药名选项；L1 / 不 blocked / 无 citations', () => {
    const options = [{ drugId: 'd1', drugName: '测试药' }]
    const r = buildClarifyResult(options)
    expect(r.status).toBe('clarify')
    expect(r.riskLevel).toBe('L1')
    expect(r.blocked).toBe(false)
    expect(r.citations).toEqual([])
    expect(r.sections?.summary).toContain('哪种药')
    expect(r.clarifyOptions).toEqual(options)
  })
})
