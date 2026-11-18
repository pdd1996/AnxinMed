/**
 * /api/auth 路由（G7 · 过渡实现；P1 增手机号验证码登录/注册）——登录 / 登出 / 当前登录态 / 改姓名。
 *
 * 挂载在 resolveUser 之前（同 /api/health）：本文件自己解析 Bearer 凭据，
 * 因为 login 必须匿名可达、me/logout 的 401 语义与业务路由不同（前端 bootstrap 依赖它）。
 *
 * 约定：
 * - demo 模式不出现登录：/me 直接返回 p-001 + mode='demo'，login 与手机号验证码接口明确拒绝（400）；
 *   PATCH /me 同样作用于 p-001（本地模拟用户，与其余写接口的 demo 行为一致）；
 * - 失败统一 { ok:false, code, message }；登录失败 401 AUTH_INVALID，限流 429 AUTH_LOCKED；
 *   手机号：发码 429 SMS_LIMITED / 503 SMS_NOT_CONFIGURED·SMS_SEND_FAILED，核验失败 401 AUTH_CODE_INVALID。
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  AUTH_INVALID_MESSAGE,
  AUTH_REQUIRED_MESSAGE,
  ERR_CODES,
  LoginRequestSchema,
  PasswordSetRequestSchema,
  PhoneLoginRequestSchema,
  SendPhoneCodeRequestSchema,
  UpdateMeRequestSchema,
  type AuthMode,
  type AuthUser,
  type PasswordSetResponse,
  type PhoneLoginResponse,
  type SendPhoneCodeResponse,
} from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { ApiError, okJson, vJson } from '../lib/http.js'
import { SMS_CODE_COOLDOWN_SEC, SMS_CODE_TTL_SEC } from '../lib/auth/sms-rate-limit.js'
import { readAuthMode } from '../lib/auth/mode.js'
import {
  getDemoUser,
  login,
  logout,
  publicUser,
  readBearer,
  resolveSessionUser,
  setUserPassword,
  updateUserName,
} from '../services/auth.service.js'
import { loginWithPhoneCode, sendLoginCode } from '../services/phone-auth.service.js'

/** 客户端标识：取 x-forwarded-for 首段（Caddy/反代），直连测试为 'local'。 */
function clientKey(c: Context<AppEnv>): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

/** 当前登录态响应体（GET /me 与 PATCH /me 同形，前端可整块替换 store）。 */
type CurrentAuth = { mode: AuthMode; user: AuthUser }

/**
 * 当前登录用户（已转对外安全对象）—— GET/PATCH /me 共用同一套解析语义：
 * demo 注入 p-001；password 模式必须带有效 Bearer（401 语义与业务路由一致）。
 *
 * 显式标注返回类型：hc<AppType> 要能从两条分支推出**单一**响应形态，
 * 否则前端 `data.user` 会退化成联合类型。
 */
async function readCurrentAuth(c: Context<AppEnv>): Promise<CurrentAuth> {
  const mode = readAuthMode()
  if (mode === 'demo') return { mode, user: publicUser(await getDemoUser()) }

  const token = readBearer(c.req.header('authorization'))
  if (!token) throw new ApiError(401, ERR_CODES.AUTH_REQUIRED, AUTH_REQUIRED_MESSAGE)
  const user = await resolveSessionUser(token)
  if (!user) throw new ApiError(401, ERR_CODES.AUTH_INVALID, AUTH_INVALID_MESSAGE)
  return { mode, user: publicUser(user) }
}

export const authRoute = new Hono<AppEnv>()
  .post('/login', vJson(LoginRequestSchema), async (c) => {
    const mode = readAuthMode()
    if (mode === 'demo') {
      throw new ApiError(400, ERR_CODES.VALIDATION, '演示模式已自动登录，无需账号密码')
    }
    const { username, password } = c.req.valid('json')
    const { token, user } = await login(username, password, clientKey(c))
    return okJson(c, { mode, token, user: publicUser(user) })
  })
  // P1：发送手机号验证码（登录/注册共用；未注册手机号验码通过后自动建号）。
  .post('/phone/send-code', vJson(SendPhoneCodeRequestSchema), async (c) => {
    const mode = readAuthMode()
    if (mode === 'demo') {
      throw new ApiError(400, ERR_CODES.VALIDATION, '演示模式已自动登录，无需验证码')
    }
    const { phone } = c.req.valid('json')
    const { signName } = await sendLoginCode(phone, clientKey(c))
    const payload: SendPhoneCodeResponse = {
      mode,
      cooldownSec: SMS_CODE_COOLDOWN_SEC,
      expiresInSec: SMS_CODE_TTL_SEC,
      signName,
    }
    return okJson(c, payload)
  })
  // P1：手机号 + 验证码登录；手机号首次通过核验 → 自动注册并发会话（验证码即注册）。
  .post('/phone/login', vJson(PhoneLoginRequestSchema), async (c) => {
    const mode = readAuthMode()
    if (mode === 'demo') {
      throw new ApiError(400, ERR_CODES.VALIDATION, '演示模式已自动登录，无需验证码登录')
    }
    const { phone, code } = c.req.valid('json')
    const { token, user, created } = await loginWithPhoneCode(phone, code)
    const payload: PhoneLoginResponse = { mode, token, user: publicUser(user), created }
    return okJson(c, payload)
  })
  // P1 增补：设置 / 修改密码（登录态下调用；手机号账号补密码后可用「手机号 + 密码」登录）。
  // 当前密码不正确返回 400 AUTH_PASSWORD_INVALID（不用 401，避免前端误清登录态）。
  .post('/password', vJson(PasswordSetRequestSchema), async (c) => {
    const mode = readAuthMode()
    if (mode === 'demo') {
      throw new ApiError(400, ERR_CODES.VALIDATION, '演示模式无需设置密码')
    }
    const token = readBearer(c.req.header('authorization'))
    if (!token) throw new ApiError(401, ERR_CODES.AUTH_REQUIRED, AUTH_REQUIRED_MESSAGE)
    const user = await resolveSessionUser(token)
    if (!user) throw new ApiError(401, ERR_CODES.AUTH_INVALID, AUTH_INVALID_MESSAGE)
    const updated = await setUserPassword(user, c.req.valid('json'))
    const payload: PasswordSetResponse = { mode, user: publicUser(updated) }
    return okJson(c, payload)
  })
  .post('/logout', async (c) => {
    const token = readBearer(c.req.header('authorization'))
    if (token) await logout(token)
    return okJson(c, { mode: readAuthMode() })
  })
  .get('/me', async (c) => okJson(c, await readCurrentAuth(c)))
  // 改姓名（G8 增补）：只改 users.name，不碰凭据/会话——改完 token 仍有效。
  // 未登录 → 401（readCurrentAuth）；姓名非法 → 400（vJson，文案来自 shared 契约）。
  .patch('/me', vJson(UpdateMeRequestSchema), async (c) => {
    const { mode, user } = await readCurrentAuth(c)
    const updated = await updateUserName(user.id, c.req.valid('json').name)
    const payload: CurrentAuth = { mode, user: publicUser(updated) }
    return okJson(c, payload)
  })
