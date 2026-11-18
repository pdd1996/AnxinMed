/**
 * /api/auth 路由（G7 · 过渡实现）——登录 / 登出 / 当前登录态 / 改姓名。
 *
 * 挂载在 resolveUser 之前（同 /api/health）：本文件自己解析 Bearer 凭据，
 * 因为 login 必须匿名可达、me/logout 的 401 语义与业务路由不同（前端 bootstrap 依赖它）。
 *
 * 约定：
 * - demo 模式不出现登录：/me 直接返回 p-001 + mode='demo'，login 明确拒绝（400）；
 *   PATCH /me 同样作用于 p-001（本地模拟用户，与其余写接口的 demo 行为一致）；
 * - 失败统一 { ok:false, code, message }；登录失败 401 AUTH_INVALID，限流 429 AUTH_LOCKED。
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  AUTH_INVALID_MESSAGE,
  AUTH_REQUIRED_MESSAGE,
  ERR_CODES,
  LoginRequestSchema,
  UpdateMeRequestSchema,
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
  updateUserName,
} from '../services/auth.service.js'

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
    const clientKey = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const { token, user } = await login(username, password, clientKey)
    return okJson(c, { mode, token, user: publicUser(user) })
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
