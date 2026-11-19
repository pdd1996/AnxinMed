/**
 * 绑定码核销限流（specs/25 §5 补强）——单实例内存，与 G7 登录失败限流、P1 发码限流同构。
 *
 * 目标：绑定码是 6 位数字（1e6 空间），没有限流时可被脚本在 10 分钟有效期内枚举。
 * 两道闸门（只作用于「患者核销绑定码」这一动作）：
 * 1) 患者账号维度：10 分钟窗口内最多 BIND_REDEEM_PER_10MIN 次（默认 5）；
 * 2) 客户端 IP 维度：10 分钟窗口内最多 BIND_REDEEM_IP_PER_10MIN 次（默认 20），覆盖「换号刷」。
 *
 * 口径：
 * - 每次核销尝试都计数（含敲错/过期/成功）；成功核销后清空**该患者**计数，正常用户不被历史误伤；
 * - 任一维度超限 → 429 BIND_LOCKED + retryAfterSec（请求不执行业务，枚举被窗口卡死）；
 * - NODE_ENV=test 默认关闭（保证既有集成测试不被时间窗口干扰）；RL_FORCE=1 强制开启（集成测试用），
 *   单测可 resetBindRateLimits() 清零。
 *
 * 已知边界（同 G7/G10/P1）：单实例内存，多副本部署前需换共享存储（Redis 等）；进程重启清零
 * （限流属瞬时保护，不做持久化）。这是 specs/25 方案 B「限流+审计表」中限流部分的落地，审计表仍留 B。
 */
import { isRateLimitEnabled, SlidingWindowLimiter } from './observability/rate-limit.js'

/** 限流窗口：10 分钟（与绑定码有效期同档，覆盖一次「生成 → 口述 → 输入」全过程）。 */
export const BIND_REDEEM_WINDOW_MS = 10 * 60 * 1000

const DEFAULT_PER_PATIENT = 5
const DEFAULT_PER_IP = 20

/** 读正整数 env：缺省/空 → 默认；非法 → 默认并打印可见告警（不静默改行为）。 */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`[bind:rate-limit] 环境变量 ${name} 非法（${raw}），回落默认值 ${fallback}`)
    return fallback
  }
  return n
}

export interface BindRedeemDecision {
  allowed: boolean
  /** 建议等待秒数（allowed=false 时 > 0；服务端随 429 返回，前端文案用它）。 */
  retryAfterSec: number
}

let patientLimiter: SlidingWindowLimiter | null = null
let patientLimiterSignature = ''
let ipLimiter: SlidingWindowLimiter | null = null
let ipLimiterSignature = ''

function getPatientLimiter(): SlidingWindowLimiter {
  const perPatient = readPositiveInt('BIND_REDEEM_PER_10MIN', DEFAULT_PER_PATIENT)
  if (!patientLimiter || patientLimiterSignature !== String(perPatient)) {
    patientLimiter = new SlidingWindowLimiter(perPatient, BIND_REDEEM_WINDOW_MS)
    patientLimiterSignature = String(perPatient)
  }
  return patientLimiter
}

function getIpLimiter(): SlidingWindowLimiter {
  const perIp = readPositiveInt('BIND_REDEEM_IP_PER_10MIN', DEFAULT_PER_IP)
  if (!ipLimiter || ipLimiterSignature !== String(perIp)) {
    ipLimiter = new SlidingWindowLimiter(perIp, BIND_REDEEM_WINDOW_MS)
    ipLimiterSignature = String(perIp)
  }
  return ipLimiter
}

/**
 * 核销前闸门：先患者维度、再 IP 维度（任一超限即拒）。
 * 测试环境默认放行（与 G10/P1 一致）；RL_FORCE=1 可强制开启。
 */
export function consumeBindRedeem(patientId: string, clientKey: string): BindRedeemDecision {
  if (!isRateLimitEnabled()) return { allowed: true, retryAfterSec: 0 }

  const patientDecision = getPatientLimiter().consume(patientId)
  if (!patientDecision.allowed) return patientDecision

  return getIpLimiter().consume(clientKey)
}

/** 核销成功后清空该患者的尝试计数（IP 维度保留，仍受 IP 配额约束）。 */
export function clearBindRedeemForPatient(patientId: string): void {
  getPatientLimiter().resetKey(patientId)
}

/** 测试专用：清空两个限流器实例（不清 env）。 */
export function resetBindRateLimits(): void {
  patientLimiter = null
  patientLimiterSignature = ''
  ipLimiter = null
  ipLimiterSignature = ''
}
