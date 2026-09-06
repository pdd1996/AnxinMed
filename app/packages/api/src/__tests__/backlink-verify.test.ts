/**
 * M2-T3 · verifyBacklink 单测（回链校验）。
 * 覆盖：逐字可寻通过、模型改写药名被拦截、空白/全半角差异归一后可寻、多字段分类、
 *       空输入、正则元字符按字面处理（includes 非 RegExp）、normalizeForBacklink 归一。
 */
import { describe, it, expect } from 'vitest'
import { verifyBacklink, normalizeForBacklink } from '../services/backlink/index.js'

// L0 裁剪后的正文（Rp..处方完毕 之间的药品明细）
const BODY = ['Rp', '苯磺酸氨氯地平片 5mg × 14片', '用法：每次1片 每日1次 共7天', '处方完毕'].join('\n')

describe('verifyBacklink · 回链校验', () => {
  it('值在正文逐字可寻 → verified，无拦截', () => {
    const r = verifyBacklink({ 'items[0].drugName': '苯磺酸氨氯地平片' }, BODY)
    expect(r.verified).toEqual({ 'items[0].drugName': '苯磺酸氨氯地平片' })
    expect(r.rejected).toEqual([])
    expect(r.interceptedCount).toBe(0)
  })

  it('模型改写了药名（正文没有的名字）→ 必须被拦截', () => {
    const r = verifyBacklink({ 'items[0].drugName': '硝苯地平片' }, BODY)
    expect(r.verified).toEqual({})
    expect(r.rejected).toEqual(['items[0].drugName'])
    expect(r.interceptedCount).toBe(1)
  })

  it('空白差异（模型多/少空格）→ 去空白归一后可寻', () => {
    const r = verifyBacklink({ 'items[0].usage': '每次1片   每日1次 共7天' }, BODY)
    expect(r.verified['items[0].usage']).toBe('每次1片   每日1次 共7天') // 保留模型原值
    expect(r.interceptedCount).toBe(0)
  })

  it('全半角差异（模型返回全角数字/字母）→ 半角归一后可寻', () => {
    const r = verifyBacklink({ 'items[0].specification': '５ｍｇ', 'items[0].quantity': '１４片' }, BODY)
    expect(r.verified).toEqual({ 'items[0].specification': '５ｍｇ', 'items[0].quantity': '１４片' })
    expect(r.interceptedCount).toBe(0)
  })

  it('多字段混合：可寻的进 verified，不可寻的进 rejected，计数正确', () => {
    const r = verifyBacklink(
      { 'items[0].drugName': '苯磺酸氨氯地平片', 'items[0].usage': '每次2片 每日3次' },
      BODY,
    )
    expect(Object.keys(r.verified)).toEqual(['items[0].drugName'])
    expect(r.rejected).toEqual(['items[0].usage'])
    expect(r.interceptedCount).toBe(1)
  })

  it('空 fields → 全空结果，不报错', () => {
    expect(verifyBacklink({}, BODY)).toEqual({ verified: {}, rejected: [], interceptedCount: 0 })
  })

  it('空正文 / 空值 → 一律拒（无从校验，不猜）', () => {
    expect(verifyBacklink({ a: '苯磺酸氨氯地平片' }, '').rejected).toEqual(['a'])
    expect(verifyBacklink({ a: '' }, BODY).rejected).toEqual(['a'])
    expect(verifyBacklink({ a: '   ' }, BODY).rejected).toEqual(['a']) // 归一后为空
  })

  it('正则元字符按字面处理（用 includes 非 RegExp）：幻觉通配不被误判可寻', () => {
    // 若误用未转义正则，'苯磺酸.*片' 的 .* 会匹配 '氨氯地平' → 错误 verified
    const r = verifyBacklink({ x: '苯磺酸.*片' }, BODY)
    expect(r.rejected).toEqual(['x'])
    // 反之，含字面特殊字符但确实存在的值仍应通过
    expect(verifyBacklink({ q: '5mg×14片' }, BODY).verified).toEqual({ q: '5mg×14片' })
  })

  it('normalizeForBacklink：去所有空白 + 全角转半角', () => {
    expect(normalizeForBacklink(' Ａｂｃ１２３ ')).toBe('Abc123')
    expect(normalizeForBacklink('每次 1片\t每日1次')).toBe('每次1片每日1次')
    expect(normalizeForBacklink('')).toBe('')
  })
})
