/**
 * M5-T2 · core API 层接缝单测：unwrap 的拆包行为 + 错误提示注入点（未装配时不吞错、装配后逐字转达）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { setApiNotifier, unwrap } from './client'

/** 构造一个伪 Response（unwrap 只用 ok/json 两个成员）。 */
function res(ok: boolean, body: unknown) {
  return { ok, json: () => Promise.resolve(body as { ok: boolean }) }
}

afterEach(() => {
  setApiNotifier({ onError: () => {} })
})

describe('unwrap · 成功分支', () => {
  it('res.ok 且 body.ok → 原样返回响应体', async () => {
    const body = { ok: true, items: [1, 2] }
    await expect(unwrap(res(true, body))).resolves.toBe(body)
  })
})

describe('unwrap · 失败分支必须可见（执行总纲 §0.5）', () => {
  it('body.ok=false → 抛出 message，并把 message+code 交给注入的 notifier', async () => {
    const onError = vi.fn()
    setApiNotifier({ onError })
    await expect(
      unwrap(res(false, { ok: false, code: 'AI_UNAVAILABLE', message: '识别服务暂不可用' })),
    ).rejects.toThrow('识别服务暂不可用')
    expect(onError).toHaveBeenCalledWith('识别服务暂不可用', 'AI_UNAVAILABLE')
  })

  it('res.ok=false 且无 message → 兜底文案，code 缺省传 undefined', async () => {
    const onError = vi.fn()
    setApiNotifier({ onError })
    await expect(unwrap(res(false, { ok: false }))).rejects.toThrow('请求失败，请稍后重试')
    expect(onError).toHaveBeenCalledWith('请求失败，请稍后重试', undefined)
  })

  it('未装配 notifier（默认 no-op）→ 依然抛错：提示可以没有，错误不能静默', async () => {
    await expect(unwrap(res(false, { ok: false, message: '炸了' }))).rejects.toThrow('炸了')
  })
})
