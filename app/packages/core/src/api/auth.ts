/**
 * 认证 API（G7）—— 登录 / 当前登录态 / 登出。
 *
 * 只做传输与 token 装配；登录态状态机、持久化与启动恢复在 lib/auth.ts。
 * 错误策略：本层不弹 toast（silent），由调用方（登录页/路由守卫）渲染可理解文案。
 */
import { client, setAuthToken, unwrap } from './client'

/**
 * 账号密码登录：成功返回 { mode, token, user } 并立即让后续请求带 Bearer。
 * 失败抛 ApiRequestError（code=AUTH_INVALID / AUTH_LOCKED / VALIDATION），登录页负责展示。
 */
export async function loginWithPassword(username: string, password: string) {
  const res = await client.api.auth.login.$post({ json: { username, password } })
  const data = await unwrap(res, { silent: true })
  setAuthToken(data.token)
  return data
}

/** 当前登录态（demo 模式返回 mode='demo' + p-001，不出现登录页）。 */
export async function fetchAuthMe() {
  const res = await client.api.auth.me.$get()
  return unwrap(res, { silent: true })
}

/**
 * 登出：服务端删 session；无论网络是否成功，本地 token 一定清掉（用户意图是退出）。
 * 返回 void；失败细节不打扰用户（路由守卫会把界面切回登录页）。
 */
export async function logoutSession(): Promise<void> {
  try {
    await client.api.auth.logout.$post()
  } catch {
    // 登出以本地清除为准；session 会在 7 天后自然过期。
  } finally {
    setAuthToken(null)
  }
}
