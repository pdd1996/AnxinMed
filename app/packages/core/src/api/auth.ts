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

/**
 * 发送手机号登录/注册验证码（P1）。
 * 成功返回 { cooldownSec, expiresInSec, signName }——登录页用倒计时与「短信落款为 XX」提示。
 * 失败抛 ApiRequestError（SMS_LIMITED / SMS_SEND_FAILED / SMS_NOT_CONFIGURED / VALIDATION），
 * 页面自己渲染可读文案（silent：不叠全局 toast，避免同一条错误说两遍）。
 */
export async function requestPhoneLoginCode(phone: string) {
  const res = await client.api.auth.phone['send-code'].$post({ json: { phone } })
  return unwrap(res, { silent: true })
}

/**
 * 手机号 + 验证码登录/注册（P1，验证码即注册）：成功等同密码登录——
 * 写 Bearer、返回 { mode, token, user, created }；created=true 表示本次自动建号。
 */
export async function loginWithPhone(phone: string, code: string) {
  const res = await client.api.auth.phone.login.$post({ json: { phone, code } })
  const data = await unwrap(res, { silent: true })
  setAuthToken(data.token)
  return data
}

/**
 * 设置 / 修改密码（P1）：
 * - 手机号验证码注册的账号（无密码）：只传 password，服务端把账号名设为手机号；
 * - 已有密码账号：必须同时传 oldPassword。
 * 成功返回与 GET /me 同形（user.hasPassword=true），调用方整块替换登录态。
 * silent：个人资料页自己在表单里渲染失败文案（当前密码不正确 / 两次输入不一致等）。
 */
export async function setAccountPassword(input: { oldPassword?: string; password: string }) {
  const res = await client.api.auth.password.$post({ json: input })
  return unwrap(res, { silent: true })
}

/** 当前登录态（demo 模式返回 mode='demo' + p-001，不出现登录页）。 */
export async function fetchAuthMe() {
  const res = await client.api.auth.me.$get()
  return unwrap(res, { silent: true })
}

/**
 * 改姓名（G8 增补）：成功返回与 GET /me 同形的 { mode, user }，调用方可整块替换登录态。
 *
 * silent：个人资料页在表单里自己渲染失败文案（「姓名最多 20 个字」这类逐字段提示），
 * 再叠一个全局 toast 就成了同一错误说两遍。失败仍抛出，页面必须展示。
 */
export async function updateMeName(name: string) {
  const res = await client.api.auth.me.$patch({ json: { name } })
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
