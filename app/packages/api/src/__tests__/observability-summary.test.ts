/**
 * G10 集成测试：GET /api/observability/summary —— 未配置 token 404 / token 错 401 / 正确 200 + 数据形状。
 *
 * 端点注册在 resolveUser 之前（不依赖用户登录）；LOG_DIR 指向临时目录，指标/错误计数取进程内状态。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../app.js'
import { logApiError, resetErrorLogForTests } from '../lib/observability/error-log.js'
import { getRateLimitedCount, resetRateLimitersForTests } from '../lib/observability/rate-limit.js'
import { recordModelCall, resetMetricsForTests } from '../lib/observability/metrics.js'

const TOKEN = 'test-obs-token-1234567890'
const ORIGINAL_OBS_TOKEN = process.env.OBS_ADMIN_TOKEN
const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE
const ORIGINAL_LOG_DIR = process.env.LOG_DIR

interface SummaryClient {
  attempts: number
  success: number
  failure: number
  retries: number
  avgLatencyMs: number
  tokens: { prompt: number; completion: number; cached: number; total: number }
}

interface SummaryData {
  date: string
  modelCalls: { byClient: Record<string, SummaryClient>; totals: SummaryClient }
  estimatedCostCny: number
  budget: { limitCny: number; spentCny: number; percent: number; status: string }
  rateLimited: number
  errors: number
  uptimeSec: number
  version: string
}

interface SummaryEnvelope {
  ok: boolean
  data?: SummaryData
  code?: string
  message?: string
}

let dir = ''

async function getSummary(headers: Record<string, string> = {}) {
  const res = await app.request('/api/observability/summary', { headers })
  return { status: res.status, body: (await res.json()) as SummaryEnvelope, headers: res.headers }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anxin-obs-summary-'))
  process.env.LOG_DIR = dir
  process.env.AUTH_MODE = 'demo'
  delete process.env.OBS_ADMIN_TOKEN
  delete process.env.LLM_DAILY_BUDGET_CNY
  delete process.env.LLM_PRICE_INPUT_CNY_PER_M
  delete process.env.LLM_PRICE_OUTPUT_CNY_PER_M
  delete process.env.LLM_PRICE_CACHED_CNY_PER_M
  resetMetricsForTests()
  resetErrorLogForTests()
  resetRateLimitersForTests()
})

afterEach(() => {
  resetMetricsForTests()
  resetErrorLogForTests()
  resetRateLimitersForTests()
  if (ORIGINAL_OBS_TOKEN === undefined) delete process.env.OBS_ADMIN_TOKEN
  else process.env.OBS_ADMIN_TOKEN = ORIGINAL_OBS_TOKEN
  if (ORIGINAL_AUTH_MODE === undefined) delete process.env.AUTH_MODE
  else process.env.AUTH_MODE = ORIGINAL_AUTH_MODE
  if (ORIGINAL_LOG_DIR === undefined) delete process.env.LOG_DIR
  else process.env.LOG_DIR = ORIGINAL_LOG_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('鉴权：OBS_ADMIN_TOKEN 未设置 / token 错误', () => {
  it('未设置 OBS_ADMIN_TOKEN → 404，与 notFound 同文案（不暴露端点存在性）', async () => {
    const summary = await getSummary()
    expect(summary.status).toBe(404)
    expect(summary.body).toEqual({ ok: false, code: 'NOT_FOUND', message: '路由不存在' })

    const unknown = await app.request('/api/no-such-route-for-observability')
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual(summary.body)
  })

  it('token 缺失 / 错误 / 长度不等 → 401 AUTH_INVALID（长度不等直接 false）', async () => {
    process.env.OBS_ADMIN_TOKEN = TOKEN

    const missing = await getSummary()
    expect(missing.status).toBe(401)
    expect(missing.body).toMatchObject({ ok: false, code: 'AUTH_INVALID' })

    const wrong = await getSummary({ 'x-obs-token': `${TOKEN}-wrong` })
    expect(wrong.status).toBe(401)

    const short = await getSummary({ 'x-obs-token': 'short' })
    expect(short.status).toBe(401)

    // 错误响应不回显 token
    expect(JSON.stringify(short.body)).not.toContain(TOKEN)
  })
})

describe('200 + 数据形状（无 PII）', () => {
  it('正确 token → 200 + data：模型调用/tokens/成本/预算/限流/错误/uptime/version', async () => {
    process.env.OBS_ADMIN_TOKEN = TOKEN

    recordModelCall({
      client: 'qwen-text',
      attempt: 0,
      success: true,
      latencyMs: 120,
      usage: { prompt: 1000, completion: 200, cached: 400 },
    })
    recordModelCall({ client: 'qwen', attempt: 1, success: false, latencyMs: 30 })
    logApiError({
      event: 'request_error',
      code: 'INTERNAL',
      status: 500,
      method: 'GET',
      path: '/api/boom',
      requestId: 'rid-summary-1',
      errorName: 'Error',
      message: '联系人电话13812345678',
    })

    const res = await getSummary({ 'x-obs-token': TOKEN })
    expect(res.status).toBe(200)
    const body = res.body
    expect(body.ok).toBe(true)
    const data = body.data!
    expect(data).toBeTruthy()

    expect(data.modelCalls.byClient['qwen-text']).toMatchObject({
      attempts: 1,
      success: 1,
      failure: 0,
      retries: 0,
      tokens: { prompt: 1000, completion: 200, cached: 400, total: 1200 },
    })
    expect(data.modelCalls.byClient.qwen).toMatchObject({ attempts: 1, success: 0, failure: 1, retries: 1 })
    expect(data.modelCalls.totals.attempts).toBe(2)
    expect(data.modelCalls.totals.tokens.total).toBe(1200)

    expect(data.estimatedCostCny).toBeGreaterThan(0)
    expect(data.budget).toMatchObject({ limitCny: 20, status: 'ok' })
    expect(typeof data.budget.spentCny).toBe('number')
    expect(typeof data.budget.percent).toBe('number')

    expect(data.rateLimited).toBe(getRateLimitedCount())
    expect(data.errors).toBe(1)
    expect(data.uptimeSec).toBeGreaterThanOrEqual(0)
    expect(data.version).toBe('0.1.0')
    expect(typeof data.date).toBe('string')

    // 无 PII：脱敏后的手机号不出现在响应里；观测 token 绝不回显
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('13812345678')
    expect(raw).not.toContain(TOKEN)
  })

  it('x-request-id：健康检查与观测端点响应头都带（crypto.randomUUID 形态）', async () => {
    process.env.OBS_ADMIN_TOKEN = TOKEN
    const health = await app.request('/api/health')
    expect(health.status).toBe(200)
    expect(health.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)

    const summary = await getSummary({ 'x-obs-token': TOKEN })
    expect(summary.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })
})
