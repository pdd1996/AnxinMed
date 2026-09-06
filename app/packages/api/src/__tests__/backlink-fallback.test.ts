/**
 * M2-T3 · 兜底解析编排集成测（resolveFallback）。
 * 覆盖：无缺项不触发、正则缺项→兜底→回链通过（合并）、回链拦截（仍人工补）、
 *       模型不可用降级、只发白名单文本（不发前记 PII）、纯函数不改入参、仅缺 items 数组时无从兜底。
 * 用 mock fallbackParse（DI 接缝），不真调 Baichuan。
 */
import { describe, it, expect } from 'vitest'
import { resolveFallback } from '../services/backlink/index.js'
import { parseWhitelist } from '../services/sanitize/index.js'
import { AIUnavailableError, type FallbackFields } from '../lib/ai/types.js'

/** 构造只含 fallbackParse 的 mock 客户端，并记录每次调用入参（供隐私断言）。 */
function mockClients(impl: (bodyText: string, missing: string[]) => Promise<FallbackFields>) {
  const calls: { bodyText: string; missingFields: string[] }[] = []
  return {
    calls,
    fallbackParse: async (bodyText: string, missingFields: string[]) => {
      calls.push({ bodyText, missingFields })
      return impl(bodyText, missingFields)
    },
  }
}

// 用法用量与药品同一行 → 正则把它并进了药品行、usage 留空（缺项），但 usage 文本仍在正文里可回链
const RX_MISSING_USAGE = ['Rp', '苯磺酸氨氯地平片 5mg × 14片 每次1片 每日1次 共7天', '处方完毕'].join('\n')
const BODY_WITH_USAGE = '苯磺酸氨氯地平片 5mg × 14片 每次1片 每日1次 共7天'

describe('resolveFallback · 兜底解析编排', () => {
  it('无缺项（complete）→ 不触发兜底，模型不被调用', async () => {
    const complete = [
      '第一人民医院', '处方号：RX001', '科别：内科', '2026年3月5日', '临床诊断：感冒',
      'Rp', '阿莫西林胶囊 0.25g × 12粒', '用法：每次2粒 每日3次', '处方完毕',
    ].join('\n')
    const parse = parseWhitelist(complete)
    expect(parse.complete).toBe(true)
    const ai = mockClients(async () => ({}))
    const out = await resolveFallback(parse, '任意正文', ai)
    expect(out.fallbackTriggered).toBe(false)
    expect(out.fallbackStatus).toBe('not_needed')
    expect(ai.calls).toHaveLength(0)
  })

  it('正则缺 usage → 兜底返回可寻值 → 回链通过并合并，needsManual 清除该项', async () => {
    const parse = parseWhitelist(RX_MISSING_USAGE)
    expect(parse.needsManual).toContain('items[0].usage')
    const ai = mockClients(async () => ({ 'items[0].usage': '每次1片 每日1次 共7天' }))
    const out = await resolveFallback(parse, BODY_WITH_USAGE, ai)
    expect(out.fallbackStatus).toBe('success')
    expect(out.fallbackTriggered).toBe(true)
    expect(out.whitelist.items[0].usage).toBe('每次1片 每日1次 共7天')
    expect(out.needsManual).not.toContain('items[0].usage')
    expect(out.backlinkIntercepted).toBe(0)
  })

  it('正则缺 usage → 兜底返回改写/幻觉值（正文不可寻）→ 回链拦截，仍走人工补', async () => {
    const parse = parseWhitelist(RX_MISSING_USAGE)
    const ai = mockClients(async () => ({ 'items[0].usage': '每次2片 每日3次' })) // 正文是每次1片每日1次
    const out = await resolveFallback(parse, BODY_WITH_USAGE, ai)
    expect(out.fallbackStatus).toBe('success') // 兜底跑了，但值被拦
    expect(out.whitelist.items[0].usage).toBe('') // 未预填猜测
    expect(out.needsManual).toContain('items[0].usage')
    expect(out.backlinkIntercepted).toBe(1)
  })

  it('模型不可用（AIUnavailableError）→ 降级：缺项原样保留、状态可见、不抛', async () => {
    const parse = parseWhitelist(RX_MISSING_USAGE)
    const ai = mockClients(async () => {
      throw new AIUnavailableError('baichuan', '兜底模型超时')
    })
    const out = await resolveFallback(parse, BODY_WITH_USAGE, ai)
    expect(out.fallbackStatus).toBe('unavailable')
    expect(out.fallbackTriggered).toBe(true)
    expect(out.needsManual).toEqual(parse.needsManual)
    expect(out.whitelist).toEqual(parse.whitelist)
    expect(out.backlinkIntercepted).toBe(0)
  })

  it('只发白名单正文给模型，绝不发含前记 PII 的全文（隐私红线）', async () => {
    const fullText = [
      '第一人民医院', '姓名：张三 电话：13812345678', '临床诊断：高血压',
      'Rp', '苯磺酸氨氯地平片 5mg × 14片 每次1片 每日1次', '处方完毕',
    ].join('\n')
    const parse = parseWhitelist(fullText)
    const bodyText = '苯磺酸氨氯地平片 5mg × 14片 每次1片 每日1次' // L0 裁剪后正文（无前记）
    const ai = mockClients(async () => ({ 'items[0].usage': '每次1片 每日1次' }))
    await resolveFallback(parse, bodyText, ai)
    expect(ai.calls).toHaveLength(1)
    expect(ai.calls[0].bodyText).toBe(bodyText)
    expect(ai.calls[0].bodyText).not.toContain('张三')
    expect(ai.calls[0].bodyText).not.toContain('13812345678')
    // 缺项字段是可回链的标量路径（不含裸 items）
    expect(ai.calls[0].missingFields).toContain('items[0].usage')
    expect(ai.calls[0].missingFields.every((f) => f !== 'items')).toBe(true)
  })

  it('纯函数：合并兜底值不修改传入的 parseResult', async () => {
    const parse = parseWhitelist(RX_MISSING_USAGE)
    const before = JSON.stringify(parse.whitelist)
    const ai = mockClients(async () => ({ 'items[0].usage': '每次1片 每日1次 共7天' }))
    await resolveFallback(parse, BODY_WITH_USAGE, ai)
    expect(JSON.stringify(parse.whitelist)).toBe(before)
    expect(parse.whitelist.items[0].usage).toBe('') // 原对象未被就地改写
  })

  it('仅缺整个 items 数组（无可回链标量字段）→ 无从兜底，不调用模型', async () => {
    const noItems = [
      '第一人民医院', '处方号：RX002', '科别：内科', '2026年3月5日', '临床诊断：感冒',
      'Rp', '处方完毕',
    ].join('\n')
    const parse = parseWhitelist(noItems)
    expect(parse.needsManual).toEqual(['items'])
    const ai = mockClients(async () => ({ items: '阿莫西林胶囊' }))
    const out = await resolveFallback(parse, '', ai)
    expect(out.fallbackTriggered).toBe(false)
    expect(out.fallbackStatus).toBe('not_needed')
    expect(out.needsManual).toEqual(['items'])
    expect(ai.calls).toHaveLength(0)
  })
})
