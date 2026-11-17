/**
 * resolveUser 中间件 —— 按 AUTH_MODE 解析当前用户（G7）。
 *
 * - demo（默认）：注入演示用户 p-001，M1–M12 既有行为与测试逐字不变（fixtures E2E 也走这条）；
 * - password：Authorization: Bearer <token> → sessions(SHA-256) → users；
 *   缺 token → 401 AUTH_REQUIRED；token 无效/过期 → 401 AUTH_INVALID（前端据此跳登录页）。
 *
 * ⚠️ 唯一 P1 替换点：接入 Better Auth（手机号验证码 session）时，仅替换本函数体——
 *    改为从 Better Auth session 解析 user 并 c.set('user', ...)；下游所有 c.get('user') 不变。
 */
import { createMiddleware } from 'hono/factory'
import { AUTH_INVALID_MESSAGE, AUTH_REQUIRED_MESSAGE, ERR_CODES } from '@anxin/shared'
import { ApiError } from '../lib/http.js'
import { readAuthMode } from '../lib/auth/mode.js'
import { getDemoUser, readBearer, resolveSessionUser } from '../services/auth.service.js'
import type { AppEnv } from '../types.js'

export const resolveUser = createMiddleware<AppEnv>(async (c, next) => {
  const mode = readAuthMode()

  if (mode === 'demo') {
    c.set('user', await getDemoUser())
    await next()
    return
  }

  const token = readBearer(c.req.header('authorization'))
  if (!token) throw new ApiError(401, ERR_CODES.AUTH_REQUIRED, AUTH_REQUIRED_MESSAGE)

  const user = await resolveSessionUser(token)
  if (!user) throw new ApiError(401, ERR_CODES.AUTH_INVALID, AUTH_INVALID_MESSAGE)

  c.set('user', user)
  await next()
})
