/**
 * G10 可观测性 · 限流（内存滑动窗口，单实例）。
 *
 * 两道闸门：
 * 1) LLM 路由按 **userId** 限：RL_LLM_PER_MIN（默认 10/分钟）+ RL_LLM_PER_DAY（默认 200/24h 滚动窗口），
 *    只挂 LLM 路由集合（POST /api/consult、/api/intake/{prescription,drug,detect}、
 *    /api/insight/{summary,queue-summary,ask}）；
 * 2) **IP 兜底**：RL_IP_PER_MIN（默认 240/分钟）覆盖 /api/*，`/api/health` 豁免（外部可用性监控不能被限流）。
 *
 * 超限：429 `{ ok:false, code:'RATE_LIMITED', message:'操作太频繁，请稍后再试' }` + Retry-After（秒）。
 * 口径：被限流的请求不执行业务（中间件短路）；限流命中计数供 summary.rateLimited 使用。
 *
 * 测试环境：NODE_ENV=test 默认关闭（避免 688 条既有集成测试误伤）；RL_FORCE=1 强制开启，
 * 单测也可直接 new SlidingWindowLimiter / LlmWindowLimiter 并注入 now。
 *
 * 已知边界（与 G7 登录失败限流同构）：单实例内存，多副本部署前需换共享存储（Redis 等）；
 * 进程重启清零（限流属瞬时保护，不做持久化）。
 */
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ERR_CODES } from '@anxin/shared'
import type { AppEnv } from '../../types.js'
import { dateKey } from './io.js'

export const RATE_LIMITED_MESSAGE = '操作太频繁，请稍后再试'

/** LLM 路由集合（method 必须为 POST，按 pathname 精确匹配）。 */
export const LLM_RATE_LIMIT_ROUTES: ReadonlySet<string> = new Set([
  '/api/consult',
  '/api/intake/prescription',
  '/api/intake/drug',
  '/api/intake/detect',
  '/api/insight/summary',
  '/api/insight/queue-summary',
  '/api/insight/ask',
])

export interface SlidingWindowDecision {
  allowed: boolean
  /** 建议的 Retry-After 秒数（allowed=true 时为 0）。 */
  retryAfterSec: number
}

/**
 * 内存滑动窗口：同一 key 在 windowMs 内最多 limit 次。
 * 时间源可注入（单测用），默认 Date.now；窗口边界按「旧命中 ≤ now - windowMs 即过期」处理。
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(limit) || limit <= 0) throw new Error(`限流 limit 非法：${limit}`)
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error(`限流 windowMs 非法：${windowMs}`)
  }

  consume(key: string): SlidingWindowDecision {
    const now = this.now()
    const cutoff = now - this.windowMs
    this.sweepIfNeeded(now)

    const existing = this.hits.get(key)
    const stamps: number[] = existing ?? []
    let firstAlive = 0
    while (firstAlive < stamps.length && (stamps[firstAlive] as number) <= cutoff) firstAlive += 1
    if (firstAlive > 0) stamps.splice(0, firstAlive)

    if (stamps.length < this.limit) {
      stamps.push(now)
      if (!existing) this.hits.set(key, stamps)
      return { allowed: true, retryAfterSec: 0 }
    }

    const oldest = stamps[0] as number
    const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000))
    return { allowed: false, retryAfterSec }
  }

  /** 测试/进程内重置。 */
  reset(): void {
    this.hits.clear()
  }

  /** 当前记录的去重 key 数（测试观察窗口清理用）。 */
  get keyCount(): number {
    return this.hits.size
  }

  /** 防长期运行内存膨胀：key 数量过多时惰性清扫已过期窗口（低频操作，不在热路径常驻）。 */
  private sweepIfNeeded(now: number): void {
    if (this.hits.size <= 10_000) return
    const cutoff = now - this.windowMs
    for (const [key, stamps] of this.hits) {
      const alive = stamps.filter((t) => t > cutoff)
      if (alive.length === 0) this.hits.delete(key)
      else this.hits.set(key, alive)
    }
  }
}

export interface LlmWindowDecision extends SlidingWindowDecision {
  /** 命中的那一档（allowed=true 时 null）；供日志/测试区分分钟档与日档。 */
  scope: 'minute' | 'day' | null
}

/** LLM 路由双档限流：先分钟档，再日档（24h 滚动）；两档都通过才放行。 */
export class LlmWindowLimiter {
  private readonly minute: SlidingWindowLimiter
  private readonly day: SlidingWindowLimiter

  constructor(options: { perMinute: number; perDay: number; now?: () => number }) {
    this.minute = new SlidingWindowLimiter(options.perMinute, 60_000, options.now)
    this.day = new SlidingWindowLimiter(options.perDay, 24 * 60 * 60 * 1000, options.now)
  }

  consume(userId: string): LlmWindowDecision {
    const minuteDecision = this.minute.consume(userId)
    if (!minuteDecision.allowed) {
      return { ...minuteDecision, scope: 'minute' }
    }
    const dayDecision = this.day.consume(userId)
    if (!dayDecision.allowed) {
      return { ...dayDecision, scope: 'day' }
    }
    return { allowed: true, retryAfterSec: 0, scope: null }
  }

  reset(): void {
    this.minute.reset()
    this.day.reset()
  }
}

export interface RateLimitConfig {
  llmPerMinute: number
  llmPerDay: number
  ipPerMinute: number
}

const DEFAULT_CONFIG: RateLimitConfig = { llmPerMinute: 10, llmPerDay: 200, ipPerMinute: 240 }

/** 读正整数 env：缺省/空 → 默认；非法 → 默认并打印可见告警（不静默改行为）。 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`[obs:rate-limit] 环境变量 ${name} 非法（${raw}），回落默认值 ${fallback}`)
    return fallback
  }
  return n
}

/** 当前限流配置（每请求读 env，便于测试/运维改参数即时生效）。 */
export function getRateLimitConfig(): RateLimitConfig {
  return {
    llmPerMinute: readPositiveInt('RL_LLM_PER_MIN', DEFAULT_CONFIG.llmPerMinute),
    llmPerDay: readPositiveInt('RL_LLM_PER_DAY', DEFAULT_CONFIG.llmPerDay),
    ipPerMinute: readPositiveInt('RL_IP_PER_MIN', DEFAULT_CONFIG.ipPerMinute),
  }
}

/**
 * 限流开关：NODE_ENV=test 默认关闭；RL_FORCE=1（或 true）强制开启。
 * 生产/开发（NODE_ENV 非 test）默认开启。
 */
export function isRateLimitEnabled(): boolean {
  const force = (process.env.RL_FORCE ?? '').trim().toLowerCase()
  if (force === '1' || force === 'true') return true
  return process.env.NODE_ENV !== 'test'
}

let llmLimiter: LlmWindowLimiter | null = null
let llmLimiterSignature = ''
let ipLimiter: SlidingWindowLimiter | null = null
let ipLimiterSignature = ''

function getLlmLimiter(config: RateLimitConfig): LlmWindowLimiter {
  const signature = `${config.llmPerMinute}:${config.llmPerDay}`
  if (!llmLimiter || llmLimiterSignature !== signature) {
    llmLimiter = new LlmWindowLimiter({ perMinute: config.llmPerMinute, perDay: config.llmPerDay })
    llmLimiterSignature = signature
  }
  return llmLimiter
}

function getIpLimiter(config: RateLimitConfig): SlidingWindowLimiter {
  const signature = `${config.ipPerMinute}`
  if (!ipLimiter || ipLimiterSignature !== signature) {
    ipLimiter = new SlidingWindowLimiter(config.ipPerMinute, 60_000)
    ipLimiterSignature = signature
  }
  return ipLimiter
}

/** 限流命中计数（summary.rateLimited；按本地日历日重置，进程重启清零）。 */
let limitedDay = ''
let limitedCount = 0

function recordRateLimited(now: Date = new Date()): void {
  const day = dateKey(now)
  if (limitedDay !== day) {
    limitedDay = day
    limitedCount = 0
  }
  limitedCount += 1
}

/** 当日限流命中数。 */
export function getRateLimitedCount(now: Date = new Date()): number {
  return limitedDay === dateKey(now) ? limitedCount : 0
}

/** 测试专用：重置限流器实例与命中计数（不清 env）。 */
export function resetRateLimitersForTests(): void {
  llmLimiter = null
  llmLimiterSignature = ''
  ipLimiter = null
  ipLimiterSignature = ''
  limitedDay = ''
  limitedCount = 0
}

/** 客户端 IP：优先 x-forwarded-for 首段（Caddy/反代），其次 x-real-ip，直连测试回 'local'。 */
function clientIp(c: Context<AppEnv>): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  const realIp = c.req.header('x-real-ip')?.trim()
  return realIp || 'local'
}

/** 429 响应：统一 { ok:false, code:RATE_LIMITED, message } + Retry-After 秒。 */
function rateLimitedResponse(c: Context<AppEnv>, retryAfterSec: number) {
  recordRateLimited()
  c.header('Retry-After', String(Math.max(1, Math.ceil(retryAfterSec))))
  return c.json({ ok: false as const, code: ERR_CODES.RATE_LIMITED, message: RATE_LIMITED_MESSAGE }, 429)
}

/**
 * LLM 路由按 userId 限流（注册在 resolveUser 之后；只对 LLM 路由集合的 POST 生效）。
 * 未解析到用户时不在这里拦——401 语义由 resolveUser 负责，失败必须可见且不混淆。
 */
export const llmRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  if (!isRateLimitEnabled()) return next()
  if (c.req.method !== 'POST') return next()
  if (!LLM_RATE_LIMIT_ROUTES.has(c.req.path)) return next()
  const user = c.get('user')
  if (!user) return next()

  const decision = getLlmLimiter(getRateLimitConfig()).consume(user.id)
  if (decision.allowed) return next()
  return rateLimitedResponse(c, decision.retryAfterSec)
})

/** IP 兜底限流（注册在业务路由之前；/api/health 豁免，保证监控探针恒可达）。 */
export const ipRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  if (!isRateLimitEnabled()) return next()
  if (c.req.path === '/api/health') return next()

  const decision = getIpLimiter(getRateLimitConfig()).consume(clientIp(c))
  if (decision.allowed) return next()
  return rateLimitedResponse(c, decision.retryAfterSec)
})
