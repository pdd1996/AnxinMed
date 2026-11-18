/**
 * P1 手机号验证码 · 发码限流（单实例内存，与 G7 登录失败限流同构）。
 *
 * 两道闸门（在阿里云频控之外的前置保护，防「短信轰炸」把账户余额打光）：
 * 1) 同手机号 60 秒冷却（与发送参数 Interval 一致，本地先拦，不白打一次接口）；
 * 2) 同 IP 每小时 N 次（默认 10，SMS_IP_PER_HOUR 可调），覆盖「换号刷」。
 *
 * 口径与 G10 限流一致：NODE_ENV=test 默认关闭（RL_FORCE=1 强制开启），单测可 resetSmsRateLimits()。
 * 已知边界（同 G7/G10）：单实例内存，多副本前需换共享存储；进程重启清零（瞬时保护，不持久化）。
 */
import { isRateLimitEnabled, SlidingWindowLimiter } from '../observability/rate-limit.js'

/** 验证码有效期（秒）——与阿里云发送参数 ValidTime 保持一致，前端也用它做文案。 */
export const SMS_CODE_TTL_SEC = 300
/** 同号重发冷却（秒）——与阿里云发送参数 Interval 保持一致，前端倒计时用它。 */
export const SMS_CODE_COOLDOWN_SEC = 60

const PHONE_COOLDOWN_MS = SMS_CODE_COOLDOWN_SEC * 1000
const IP_WINDOW_MS = 60 * 60 * 1000
const DEFAULT_IP_PER_HOUR = 10

/** 读正整数 env：缺省/空 → 默认；非法 → 默认并打印可见告警（不静默改行为）。 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`[sms:rate-limit] 环境变量 ${name} 非法（${raw}），回落默认值 ${fallback}`)
    return fallback
  }
  return n
}

export interface SmsSendDecision {
  allowed: boolean
  /** 建议等待秒数（allowed=false 时 >0；前端可提示「N 秒后再试」）。 */
  retryAfterSec: number
}

let phoneLimiter: SlidingWindowLimiter | null = null
let ipLimiter: SlidingWindowLimiter | null = null
let ipLimiterSignature = ''

function getPhoneLimiter(): SlidingWindowLimiter {
  phoneLimiter ??= new SlidingWindowLimiter(1, PHONE_COOLDOWN_MS)
  return phoneLimiter
}

function getIpLimiter(): SlidingWindowLimiter {
  const perHour = readPositiveInt('SMS_IP_PER_HOUR', DEFAULT_IP_PER_HOUR)
  if (!ipLimiter || ipLimiterSignature !== String(perHour)) {
    ipLimiter = new SlidingWindowLimiter(perHour, IP_WINDOW_MS)
    ipLimiterSignature = String(perHour)
  }
  return ipLimiter
}

/**
 * 发码前闸门：同号冷却 + 同 IP 小时配额（任一超限即拒）。
 * 测试环境默认放行（与 G10 一致），保证集成测试不被时间窗口干扰；RL_FORCE=1 可强制开启。
 */
export function consumeSmsSend(phone: string, clientKey: string): SmsSendDecision {
  if (!isRateLimitEnabled()) return { allowed: true, retryAfterSec: 0 }

  // key 不含明文手机号暴露面：仅内存 key，不落日志。
  const phoneDecision = getPhoneLimiter().consume(phone)
  if (!phoneDecision.allowed) return phoneDecision

  const ipDecision = getIpLimiter().consume(clientKey)
  if (!ipDecision.allowed) return ipDecision

  return { allowed: true, retryAfterSec: 0 }
}

/** 测试专用：清空两个限流器实例（不清 env）。 */
export function resetSmsRateLimits(): void {
  phoneLimiter = null
  ipLimiter = null
  ipLimiterSignature = ''
}
