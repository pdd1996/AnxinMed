/**
 * G10 单测：callJson 单点埋点（尝试/成功/失败/重试/latency/usage tokens）+ 当日指标落盘与重启恢复。
 *
 * 用 vi.stubGlobal('fetch') 冻结模型 I/O，不真调 API；LOG_DIR 指向临时目录隔离文件。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { callJson, extractUsageTokens } from '../lib/ai/http.js'
import { AIUnavailableError } from '../lib/ai/types.js'
import { dateKey } from '../lib/observability/io.js'
import {
  getModelCallsSummary,
  recordModelCall,
  resetMetricsForTests,
  setMetricsClockForTests,
} from '../lib/observability/metrics.js'

let dir = ''

function mkRes(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anxin-obs-metrics-'))
  process.env.LOG_DIR = dir
  delete process.env.LLM_DAILY_BUDGET_CNY
  delete process.env.LLM_PRICE_INPUT_CNY_PER_M
  delete process.env.LLM_PRICE_OUTPUT_CNY_PER_M
  delete process.env.LLM_PRICE_CACHED_CNY_PER_M
  resetMetricsForTests()
  setMetricsClockForTests(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetMetricsForTests()
  setMetricsClockForTests(null)
  delete process.env.LOG_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('extractUsageTokens（只读 usage 数值字段）', () => {
  it('解析 prompt/completion/prompt_tokens_details.cached_tokens', () => {
    expect(
      extractUsageTokens({
        usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 800 } },
      }),
    ).toEqual({ prompt: 1200, completion: 300, cached: 800 })
  })

  it('缺 usage / 非对象 / 非法数值 → null（绝不从 content 猜）', () => {
    expect(extractUsageTokens({ choices: [] })).toBeNull()
    expect(extractUsageTokens(null)).toBeNull()
    expect(extractUsageTokens({ usage: null })).toBeNull()
    expect(extractUsageTokens({ usage: { prompt_tokens: 'x' } })).toBeNull()
  })
})

describe('callJson 埋点', () => {
  it('成功响应：attempts/success/latency/usage tokens 全部计数，且返回原始响应体', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mkRes({ choices: [{ message: { content: '{"summary":"x"}' } }], usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 800 } } })),
    )

    const payload = await callJson<Record<string, unknown>>(
      'http://model.test/v1/chat/completions',
      { method: 'POST', body: '{}' },
      { client: 'qwen-text' },
    )
    expect(payload.usage).toBeTruthy()

    const summary = getModelCallsSummary()
    expect(summary.byClient['qwen-text']).toMatchObject({
      attempts: 1,
      success: 1,
      failure: 0,
      retries: 0,
      tokens: { prompt: 1200, completion: 300, cached: 800, total: 1500 },
    })
    expect(summary.totals.attempts).toBe(1)
    expect(summary.byClient['qwen-text']?.avgLatencyMs).toBeGreaterThanOrEqual(0)

    // 当日指标文件已原子落盘（无残留 .tmp）
    const file = join(dir, `metrics-${dateKey()}.json`)
    expect(existsSync(file)).toBe(true)
    const persisted = JSON.parse(readFileSync(file, 'utf8')) as {
      date: string
      clients: Record<string, { attempts: number; success: number; promptTokens: number }>
    }
    expect(persisted.date).toBe(dateKey())
    expect(persisted.clients['qwen-text']).toMatchObject({ attempts: 1, success: 1, promptTokens: 1200 })
    expect(readdirSync(dir).filter((name) => name.includes('.tmp'))).toHaveLength(0)
  })

  it('失败重试：两次尝试都计数（failure 1 / retries 1），只有成功响应累计 token', async () => {
    vi.useFakeTimers()
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        if (calls === 1) return mkRes({}, 500)
        return mkRes({ usage: { prompt_tokens: 10, completion_tokens: 2 } })
      }),
    )

    const promise = callJson<Record<string, unknown>>('http://model.test/v1/chat/completions', {}, { client: 'qwen-text' })
    await vi.advanceTimersByTimeAsync(0) // 让首次失败落地并挂上退避定时器
    await vi.advanceTimersByTimeAsync(1000) // 越过 500–750ms 退避
    await promise

    const client = getModelCallsSummary().byClient['qwen-text']
    expect(client).toMatchObject({
      attempts: 2,
      success: 1,
      failure: 1,
      retries: 1,
      tokens: { prompt: 10, completion: 2, cached: 0, total: 12 },
    })
    expect(calls).toBe(2)
  })

  it('4xx（非 429）不重试：一次失败尝试，失败也计数', async () => {
    const fetchMock = vi.fn(async () => mkRes({}, 404))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      callJson('http://model.test/v1/chat/completions', {}, { client: 'qwen' }),
    ).rejects.toBeInstanceOf(AIUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    expect(getModelCallsSummary().byClient.qwen).toMatchObject({
      attempts: 1,
      success: 0,
      failure: 1,
      retries: 0,
      tokens: { prompt: 0, completion: 0, cached: 0, total: 0 },
    })
  })

  it('网络错误重试 1 次后冒泡：failure=2 / retries=1（每次尝试都记录）', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    vi.stubGlobal('fetch', fetchMock)

    const promise = callJson('http://model.test/v1/chat/completions', {}, { client: 'baichuan' })
    const assertion = expect(promise).rejects.toBeInstanceOf(AIUnavailableError)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getModelCallsSummary().byClient.baichuan).toMatchObject({ attempts: 2, success: 0, failure: 2, retries: 1 })
  })
})

describe('当日指标落盘与重启恢复', () => {
  it('进程重启（内存清空）后 load 当日文件继续累计，预算累计不清零', () => {
    recordModelCall({ client: 'qwen', attempt: 0, success: true, latencyMs: 100, usage: { prompt: 100, completion: 10, cached: 20 } })
    resetMetricsForTests() // 模拟重启：state 清空，当日 metrics-*.json 保留
    recordModelCall({ client: 'qwen', attempt: 0, success: true, latencyMs: 50, usage: { prompt: 50, completion: 5, cached: 0 } })

    const summary = getModelCallsSummary()
    expect(summary.byClient.qwen).toMatchObject({
      attempts: 2,
      success: 2,
      failure: 0,
      tokens: { prompt: 150, completion: 15, cached: 20, total: 165 },
    })
  })
})
