/**
 * P1 手机号验证码登录/注册（阿里云号码认证服务「短信认证」）。
 *
 * 流程：sendLoginCode（本地限流 → 阿里云发码）→ loginWithPhoneCode（阿里云核验 PASS →
 * 查号/建号 → 发 session）。**验证码本身由阿里云托管**（我方不生成、不存、不校验明文），
 * 本服务只做限流、账号生命周期与会话——与 G7 的 users/sessions 架构完全复用。
 *
 * 语义：**验证码即注册**——该手机号首次通过核验时自动建号（id `u-<uuid>`），之后即登录；
 * 已注册则直接登录。与密码登录并存，老账号（username/passwordHash）不受影响。
 *
 * 安全纪律：
 * - 验证码错误不区分「没发过/输错/过期/被覆盖」，统一 CODE_INVALID_MESSAGE（防枚举）；
 * - 对外用户对象只走 publicUser（不含 phone/passwordHash）；
 * - 并发首登由 users_phone_uq 唯一索引兜底（23505 → 回读已有账号按登录处理，不产生双账号、
 *   也不静默吞错——其他数据库错误照常抛出）；
 * - 短信供应商错误码只进服务端日志与 ApiError.details，不拼进用户文案。
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  CODE_INVALID_MESSAGE,
  ERR_CODES,
  SMS_NOT_CONFIGURED_MESSAGE,
  SMS_SEND_FAILED_MESSAGE,
  SMS_TOO_FREQUENT_MESSAGE,
} from '@anxin/shared'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { ApiError } from '../lib/http.js'
import { consumeSmsSend } from '../lib/auth/sms-rate-limit.js'
import { DypnsError, checkSmsCode, readDypnsConfig, sendSmsCode } from '../lib/sms/dypns.js'
import { issueSession } from './auth.service.js'
import type { User } from '../types.js'

export interface SendLoginCodeResult {
  /** 短信落款签名（前端提示用户「短信落款为 XX，属正常」，防误判诈骗）。 */
  signName: string
}

/**
 * 发送登录/注册验证码。
 * @param clientKey 客户端标识（x-forwarded-for 首段；直连为 'local'），参与同 IP 小时配额。
 */
export async function sendLoginCode(phone: string, clientKey: string): Promise<SendLoginCodeResult> {
  const decision = consumeSmsSend(phone, clientKey)
  if (!decision.allowed) {
    throw new ApiError(429, ERR_CODES.SMS_LIMITED, SMS_TOO_FREQUENT_MESSAGE, {
      retryAfterSec: decision.retryAfterSec,
    })
  }

  const cfg = readDypnsConfig()
  if (!cfg) {
    // fail-closed：部署缺短信配置时明确报错，不静默退化成「假装已发送」。
    throw new ApiError(503, ERR_CODES.SMS_NOT_CONFIGURED, SMS_NOT_CONFIGURED_MESSAGE)
  }

  try {
    await sendSmsCode(cfg, { phone })
  } catch (err) {
    throw mapSendError(err)
  }
  return { signName: cfg.signName }
}

/** 阿里云发送错误 → 用户可理解的 ApiError（错误码保留在 details 供运维排查）。 */
function mapSendError(err: unknown): ApiError {
  if (err instanceof DypnsError) {
    // 频控：与本地冷却同语义，429 可重试。
    if (err.code === 'isv.BUSINESS_LIMIT_CONTROL' || err.code === 'FREQUENCY_FAIL') {
      return new ApiError(429, ERR_CODES.SMS_LIMITED, SMS_TOO_FREQUENT_MESSAGE, {
        providerCode: err.code,
      })
    }
    // 号码非法：属入参问题（契约已校验，这里兜底服务商判定）。
    if (err.code === 'MOBILE_NUMBER_ILLEGAL') {
      return new ApiError(400, ERR_CODES.VALIDATION, '手机号格式不正确', { providerCode: err.code })
    }
    // 其余（签名/权限/未开通/超时/网络/服务商内部异常）按「服务不可用」可见报错。
    console.error(`[sms] 发送验证码失败 [${err.code}] ${err.message}`)
    return new ApiError(503, ERR_CODES.SMS_SEND_FAILED, SMS_SEND_FAILED_MESSAGE, {
      providerCode: err.code,
    })
  }
  console.error('[sms] 发送验证码失败（非 DypnsError）', err instanceof Error ? err.name : 'NonError')
  return new ApiError(503, ERR_CODES.SMS_SEND_FAILED, SMS_SEND_FAILED_MESSAGE)
}

export interface PhoneLoginResult {
  token: string
  user: User
  /** 本次是否自动注册了新账号（首次登录）。 */
  created: boolean
}

/**
 * 手机号 + 验证码登录/注册。
 * @throws ApiError 401 AUTH_CODE_INVALID（验证码不对）/ 503（短信服务不可用）
 */
export async function loginWithPhoneCode(phone: string, code: string): Promise<PhoneLoginResult> {
  const cfg = readDypnsConfig()
  if (!cfg) {
    throw new ApiError(503, ERR_CODES.SMS_NOT_CONFIGURED, SMS_NOT_CONFIGURED_MESSAGE)
  }

  let passed = false
  try {
    // 注：isv.ValidateFail（验证码错误/过期/被覆盖）已在客户端归一为 passed=false，不算异常。
    ;({ passed } = await checkSmsCode(cfg, { phone, code }))
  } catch (err) {
    const providerCode = err instanceof DypnsError ? err.code : undefined
    console.error(`[sms] 核验验证码失败 [${providerCode ?? 'UNKNOWN'}]`)
    throw new ApiError(503, ERR_CODES.SMS_SEND_FAILED, '短信服务暂时不可用，请稍后重试', {
      ...(providerCode ? { providerCode } : {}),
    })
  }
  if (!passed) {
    // 统一 401（不区分没发过/过期/输错），前端提示「重新获取」。
    throw new ApiError(401, ERR_CODES.AUTH_CODE_INVALID, CODE_INVALID_MESSAGE)
  }

  const now = new Date()
  const [existing] = await db.select().from(users).where(eq(users.phone, phone)).limit(1)

  if (existing) {
    // 老用户：补记最近验证时间（首次通过手机号验证的用户 created_at 不变）。
    if (!existing.phoneVerifiedAt) {
      const [updated] = await db
        .update(users)
        .set({ phoneVerifiedAt: now, updatedAt: now })
        .where(eq(users.id, existing.id))
        .returning()
      return { token: await issueSession(updated ?? existing), user: updated ?? existing, created: false }
    }
    return { token: await issueSession(existing), user: existing, created: false }
  }

  // 首次验证通过 → 自动建号（验证码即注册）。
  try {
    const [created] = await db
      .insert(users)
      .values({ id: `u-${randomUUID()}`, phone, phoneVerifiedAt: now })
      .returning()
    if (!created) throw new Error('users insert 未返回行')
    return { token: await issueSession(created), user: created, created: true }
  } catch (err) {
    // 并发首登：唯一索引冲突 → 回读已有账号按登录处理（不产生双账号）。
    const code23505 = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code
    if (code23505 !== '23505') throw err
    const [dup] = await db.select().from(users).where(eq(users.phone, phone)).limit(1)
    if (!dup) throw err // 唯一冲突却查不到行 = 数据异常，必须可见
    return { token: await issueSession(dup), user: dup, created: false }
  }
}
