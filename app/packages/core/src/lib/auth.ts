/**
 * 登录流程编排（G7）——启动恢复 / 登录 / 登出 / 失效清理，web 与 App 共用一份。
 *
 * 平台触点以注入实现交付（同 core 既有接缝纪律）：
 *   · AuthTokenStorage —— token 持久化（web=localStorage，mobile=AsyncStorage）
 *   · setUnauthorizedHandler —— 401 时清登录态，路由守卫据此回登录页（各端 wiring 注入）
 *
 * demo 模式（AUTH_MODE=demo）：/api/auth/me 直接返回 p-001 → 自动 authenticated，
 * 前端不出现登录页，既有 fixtures E2E 与本地开发行为不变。
 */
import { ERR_CODES } from '@anxin/shared'
import { ApiRequestError, setAuthToken } from '../api/client'
import { fetchAuthMe, loginWithPassword, logoutSession } from '../api/auth'
import { useAuthStore } from '../stores/auth'
import { toUserMessage } from './errors'

/** 各端注入的 token 持久化后端（读/写/清）。未注入 = 纯内存（App 冷启动需重新登录）。 */
export interface AuthTokenStorage {
  load: () => Promise<string | null> | string | null
  save: (token: string) => Promise<void> | void
  clear: () => Promise<void> | void
}

let tokenStorage: AuthTokenStorage | null = null

/** 装配本端 token 持久化（web/mobile 在 wiring 里注入）。 */
export function setAuthTokenStorage(storage: AuthTokenStorage | null): void {
  tokenStorage = storage
}

function authStore() {
  return useAuthStore.getState()
}

function isAuthFailure(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.status === 401 ||
      error.code === ERR_CODES.AUTH_REQUIRED ||
      error.code === ERR_CODES.AUTH_INVALID)
  )
}

/** 清本地登录态（token + 持久化 + store），不询问服务端。 */
async function clearLocalSession(): Promise<void> {
  setAuthToken(null)
  try {
    await tokenStorage?.clear()
  } catch {
    // 清本地存储失败不影响内存态；下次启动 bootstrap 会再走一遍。
  }
  authStore().setAnonymous()
}

/**
 * 启动恢复：读持久化 token → 调 /api/auth/me → 进入 authenticated / anonymous。
 * - demo 模式无 token 也能拿到 p-001；
 * - 登录态检查失败（网络/服务异常）→ error 状态，界面给重试（不静默当未登录）；
 * - 401 → 清 token 按未登录处理。
 *
 * 幂等：加载中/已登录时重复调用直接返回（React StrictMode 双执行安全）。
 */
export async function bootstrapAuth(): Promise<void> {
  const { status } = authStore()
  if (status === 'loading' || status === 'authenticated') return
  authStore().setLoading()

  let storedToken: string | null = null
  try {
    storedToken = (await tokenStorage?.load()) ?? null
  } catch {
    storedToken = null
  }
  if (storedToken) setAuthToken(storedToken)

  try {
    const me = await fetchAuthMe()
    authStore().setAuthenticated(me.mode, me.user)
  } catch (error) {
    if (isAuthFailure(error)) {
      await clearLocalSession()
      return
    }
    // 技术异常（断网 / 超时 / 服务异常）先归成中文再进 store：界面直接展示，绝不露英文技术串。
    authStore().setError(toUserMessage(error, '登录状态检查失败，请重试'))
  }
}

/**
 * 登录：成功后写 token 持久化并切 authenticated；失败原样抛给登录页展示
 * （AUTH_INVALID/AUTH_LOCKED 的 message 已是用户可读文案）。
 */
export async function signIn(username: string, password: string): Promise<void> {
  const data = await loginWithPassword(username, password)
  try {
    await tokenStorage?.save(data.token)
  } catch {
    // 持久化失败仍保留内存登录态（本机临时可用），下次启动需重新登录。
  }
  authStore().setAuthenticated(data.mode, data.user)
}

/** 退出登录：服务端删 session（失败也继续），本地 token/状态一并清空。 */
export async function signOut(): Promise<void> {
  await logoutSession()
  await clearLocalSession()
}

/**
 * 401 统一处理入口（由各端 wiring 包一层接到 setUnauthorizedHandler）：
 * 清登录态 → 路由守卫看到 anonymous 后跳登录页。
 */
export async function resetAuthState(): Promise<void> {
  await clearLocalSession()
}
