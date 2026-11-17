/**
 * /api/auth 路由（G7 · 过渡实现）——登录 / 登出 / 当前登录态。
 *
 * 挂载在 resolveUser 之前（同 /api/health）：本文件自己解析 Bearer 凭据，
 * 因为 login 必须匿名可达、me/logout 的 401 语义与业务路由不同（前端 bootstrap 依赖它）。
 *
 * 约定：
 * - demo 模式不出现登录：/me 直接返回 p-001 + mode='demo'，login 明确拒绝（400）；
 * - 失败统一 { ok:false, code, message }；登录失败 401 AUTH_INVALID，限流 429 AUTH_LOCKED。
 */
import { Hono } from 'hono'
import {
  AUTH_INVALID_MESSAGE,
  AUTH_REQUIRED_MESSAGE,
  ERR_CODES,
  LoginRequestSchema,
  type AuthMode,
  type AuthUser,
} from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { ApiError, okJson, vJson } from '../lib/http.js'
import { readAuthMode } from '../lib/auth/mode.js'
import {
  getDemoUser,
  login,
  logout,
  publicUser,
  readBearer,
  resolveSessionUser,
} from '../services/auth.service.js'

export const authRoute = new Hono<AppEnv>()
  .post('/login', vJson(LoginRequestSchema), async (c) => {
    const mode = readAuthMode()
    if (mode === 'demo') {
      throw new ApiError(400, ERR_CODES.VALIDATION, '演示模式已自动登录，无需账号密码')
    }
    const { username, password } = c.req.valid('json')
    const clientKey = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const { token, user } = await login(username, password, clientKey)
    return okJson(c, { mode, token, user: publicUser(user) })
  })
  .post('/logout', async (c) => {
    const token = readBearer(c.req.header('authorization'))
    if (token) await logout(token)
    return okJson(c, { mode: readAuthMode() })
  })
  .get('/me', async (c) => {
    const mode = readAuthMode()
    // 显式标注响应形态：demo/password 两条分支必须是同一类型（hc<AppType> 才能推出单一 /me 响应）。
    const payload: { mode: AuthMode; user: AuthUser } =
      mode === 'demo'
        ? { mode, user: publicUser(await getDemoUser()) }
        : await (async () => {
            const token = readBearer(c.req.header('authorization'))
            if (!token) throw new ApiError(401, ERR_CODES.AUTH_REQUIRED, AUTH_REQUIRED_MESSAGE)
            const user = await resolveSessionUser(token)
            if (!user) throw new ApiError(401, ERR_CODES.AUTH_INVALID, AUTH_INVALID_MESSAGE)
            return { mode, user: publicUser(user) }
          })()
    return okJson(c, payload)
  })
