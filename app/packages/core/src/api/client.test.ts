/**
 * M5-T2 · core API 层接缝单测：unwrap 的拆包行为 + 错误提示注入点（未装配时不吞错、装配后逐字转达）。
 * M5-T4 · 追加：API 基址注入接缝（web 相对 '/'，RN 绝对地址；实例按基址惰性重建）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { client, getApiBaseUrl, setApiBaseUrl, setApiNotifier, unwrap } from './client'

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

// ── M5-T4：API 基址注入（RN 无「同源」，必须绝对地址；web 保持相对 '/'）──

/** 记录被请求 URL 的 fetch 替身（core 无 DOM lib，故只给 hc 真正用到的成员）。 */
function stubFetch(sink: string[]) {
  const impl = (input: unknown) => {
    sink.push(String(input))
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true, items: [] }),
      text: async () => '{"ok":true,"items":[]}',
    })
  }
  vi.stubGlobal('fetch', impl as unknown)
}

describe('setApiBaseUrl · 基址注入与惰性重建', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setApiBaseUrl('/')
  })

  it('默认根路径 → 相对路径（web 同源语义逐字不变）', async () => {
    expect(getApiBaseUrl()).toBe('/')
    const seen: string[] = []
    stubFetch(seen)
    await client.api.drugs.$get()
    expect(seen[0]).toBe('/api/drugs')
  })

  it('注入绝对地址（含尾斜杠）→ 请求打到该主机，尾斜杠被归一', async () => {
    setApiBaseUrl('http://192.168.110.22:8787/')
    expect(getApiBaseUrl()).toBe('http://192.168.110.22:8787')
    const seen: string[] = []
    stubFetch(seen)
    await client.api.drugs.$get()
    expect(seen[0]).toBe('http://192.168.110.22:8787/api/drugs')
  })

  it('基址改写后即时生效（实例按基址重建，不缓存旧地址）', async () => {
    const seen: string[] = []
    stubFetch(seen)
    setApiBaseUrl('http://10.0.0.1:8787')
    await client.api.drugs.$get()
    setApiBaseUrl('http://118.196.82.13:8787')
    await client.api.drugs.$get()
    expect(seen).toEqual([
      'http://10.0.0.1:8787/api/drugs',
      'http://118.196.82.13:8787/api/drugs',
    ])
  })

  it('空串/纯空白回落根路径，不会退化成无 scheme 的坏地址', () => {
    setApiBaseUrl('   ')
    expect(getApiBaseUrl()).toBe('/')
  })
})
