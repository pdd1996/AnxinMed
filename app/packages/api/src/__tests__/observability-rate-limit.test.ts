/**
 * G10 单测：限流（滑动窗口 / LLM 双档 / IP 兜底 / 429 形状 / 测试环境开关）。
 *
 * 用本地 Hono app 复现中间件行为，不写数据库、不依赖真实用户；
 * 时间源注入 now，不等待真实窗口。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv, User } from '../types.js'
import {
  getRateLimitedCount,
  ipRateLimit,
  isRateLimitEnabled,
  llmRateLimit,
  LlmWindowLimiter,
  RATE_LIMITED_MESSAGE,
  resetRateLimitersForTests,
  SlidingWindowLimiter,
} from '../lib/observability/rate-limit.js'

const ENV_KEYS = ['NODE_ENV', 'RL_FORCE', 'RL_LLM_PER_MIN', 'RL_LLM_PER_DAY', 'RL_IP_PER_MIN'] as const
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<string, string | undefined>

const FAKE_USER = { id: 'u-rl-test', name: '限流测试', username: null } as unknown as User

/** 本地 app：模拟 resolveUser 注入 user 后挂 LLM 限流中间件（只测中间件，不触业务/DB）。 */
function buildLlmApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('requestId', 'test-request-id')
    c.set('user', FAKE_USER)
    await next()
  })
  app.use('/api/*', llmRateLimit)
  app.post('/api/consult', (c) => c.json({ ok: true }))
  app.post('/api/consult/suggestions/s-1/accept', (c) => c.json({ ok: true })) // 非 LLM 路由集合
  app.post('/api/intake/drug', (c) => c.json({ ok: true }))
  app.get('/api/drugs', (c) => c.json({ ok: true }))
  return app
}

function buildIpApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('/api/*', ipRateLimit)
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.get('/api/drugs', (c) => c.json({ ok: true }))
  return app
}

beforeEach(() => {
  resetRateLimitersForTests()
  process.env.NODE_ENV = 'test'
  delete process.env.RL_FORCE
  delete process.env.RL_LLM_PER_MIN
  delete process.env.RL_LLM_PER_DAY
  delete process.env.RL_IP_PER_MIN
})

afterEach(() => {
  resetRateLimitersForTests()
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key]
    else process.env[key] = ORIGINAL_ENV[key]
  }
})

describe('SlidingWindowLimiter（可注入时钟）', () => {
  it('窗口内 limit 次放行，超限给 Retry-After；窗口滑过后恢复；不同 key 独立', () => {
    let now = 1_000_000
    const limiter = new SlidingWindowLimiter(3, 60_000, () => now)

    expect(limiter.consume('u')).toEqual({ allowed: true, retryAfterSec: 0 })
    expect(limiter.consume('u')).toEqual({ allowed: true, retryAfterSec: 0 })
    expect(limiter.consume('u')).toEqual({ allowed: true, retryAfterSec: 0 })
    expect(limiter.consume('u')).toEqual({ allowed: false, retryAfterSec: 60 })

    now += 59_000
    expect(limiter.consume('u')).toEqual({ allowed: false, retryAfterSec: 1 })

    now += 1_000 // 最早的三次命中过期
    expect(limiter.consume('u')).toEqual({ allowed: true, retryAfterSec: 0 })
    expect(limiter.consume('other')).toEqual({ allowed: true, retryAfterSec: 0 })
  })
})

describe('LlmWindowLimiter（分钟 + 24h 日档）', () => {
  it('分钟档与日档都通过才放行；日档超限 scope=day，Retry-After ≈ 剩余 24h', () => {
    let now = 1_000_000
    const limiter = new LlmWindowLimiter({ perMinute: 5, perDay: 2, now: () => now })

    expect(limiter.consume('u')).toMatchObject({ allowed: true, scope: null })
    expect(limiter.consume('u')).toMatchObject({ allowed: true, scope: null })

    const blocked = limiter.consume('u')
    expect(blocked.allowed).toBe(false)
    expect(blocked.scope).toBe('day')
    expect(blocked.retryAfterSec).toBeGreaterThan(86_000)

    now += 61_000 // 分钟窗口已过，但日档仍是满的
    expect(limiter.consume('u')).toMatchObject({ allowed: false, scope: 'day' })
  })
})

describe('环境开关：NODE_ENV=test 默认关闭，RL_FORCE=1 强制开启', () => {
  it('关闭时即使 limit=1 也全部放行；强制开启后第二次 429 RATE_LIMITED', async () => {
    process.env.RL_LLM_PER_MIN = '1'
    process.env.RL_LLM_PER_DAY = '100'

    expect(isRateLimitEnabled()).toBe(false)
    let app = buildLlmApp()
    for (let i = 0; i < 3; i += 1) {
      expect((await app.request('/api/consult', { method: 'POST' })).status).toBe(200)
    }

    process.env.RL_FORCE = '1'
    resetRateLimitersForTests()
    app = buildLlmApp()
    expect(isRateLimitEnabled()).toBe(true)
    expect((await app.request('/api/consult', { method: 'POST' })).status).toBe(200)
    const limited = await app.request('/api/consult', { method: 'POST' })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ ok: false, code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE })
  })
})

describe('429 响应形状与计数', () => {
  it('超限：429 + { ok:false, code:RATE_LIMITED, message } + Retry-After 秒；非 LLM 路由不受影响', async () => {
    process.env.RL_FORCE = '1'
    process.env.RL_LLM_PER_MIN = '1'
    process.env.RL_LLM_PER_DAY = '100'
    resetRateLimitersForTests()
    const app = buildLlmApp()

    expect((await app.request('/api/consult', { method: 'POST' })).status).toBe(200)

    const limited = await app.request('/api/consult', { method: 'POST' })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ ok: false, code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE })
    const retryAfter = Number(limited.headers.get('retry-after'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
    expect(getRateLimitedCount()).toBe(1)

    // 建议卡 accept 是 POST 但不在 LLM 路由集合：不消耗 LLM 配额
    expect((await app.request('/api/consult/suggestions/s-1/accept', { method: 'POST' })).status).toBe(200)
    // GET 也不受限
    expect((await app.request('/api/drugs')).status).toBe(200)
  })

  it('日档超限：Retry-After 为日窗口剩余（>>60s）', async () => {
    process.env.RL_FORCE = '1'
    process.env.RL_LLM_PER_MIN = '100'
    process.env.RL_LLM_PER_DAY = '2'
    resetRateLimitersForTests()
    const app = buildLlmApp()

    expect((await app.request('/api/consult', { method: 'POST' })).status).toBe(200)
    expect((await app.request('/api/consult', { method: 'POST' })).status).toBe(200)
    const limited = await app.request('/api/consult', { method: 'POST' })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(86_000)
  })
})

describe('IP 兜底限流（/api/health 豁免）', () => {
  it('同 IP 超过 RL_IP_PER_MIN 后 429（health 恒 200）；不同 IP 互不影响', async () => {
    process.env.RL_FORCE = '1'
    process.env.RL_IP_PER_MIN = '2'
    resetRateLimitersForTests()
    const app = buildIpApp()
    const sameIp = { 'x-forwarded-for': '203.0.113.9' }

    for (let i = 0; i < 3; i += 1) {
      expect((await app.request('/api/health', { headers: sameIp })).status).toBe(200)
    }
    expect((await app.request('/api/drugs', { headers: sameIp })).status).toBe(200)
    expect((await app.request('/api/drugs', { headers: sameIp })).status).toBe(200)
    const limited = await app.request('/api/drugs', { headers: sameIp })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ ok: false, code: 'RATE_LIMITED' })
    expect(getRateLimitedCount()).toBe(1)

    expect((await app.request('/api/drugs', { headers: { 'x-forwarded-for': '203.0.113.10' } })).status).toBe(200)
  })
})
