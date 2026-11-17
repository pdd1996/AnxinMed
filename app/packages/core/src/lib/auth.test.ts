/**
 * 登录流程编排（G7）单元测试：启动恢复 / 平台存储 / 401 清态 / 登录登出。
 * 只 mock 传输层与 token 注入，store 与状态机走真代码。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchAuthMe: vi.fn(),
  loginWithPassword: vi.fn(),
  logoutSession: vi.fn(),
  setAuthToken: vi.fn(),
}))

vi.mock('../api/auth', () => ({
  fetchAuthMe: mocks.fetchAuthMe,
  loginWithPassword: mocks.loginWithPassword,
  logoutSession: mocks.logoutSession,
}))

vi.mock('../api/client', () => {
  class ApiRequestError extends Error {
    constructor(
      message: string,
      public readonly code?: string,
      public readonly status?: number,
    ) {
      super(message)
      this.name = 'ApiRequestError'
    }
  }
  return { setAuthToken: mocks.setAuthToken, ApiRequestError }
})

import { ApiRequestError } from '../api/client'
import { bootstrapAuth, setAuthTokenStorage, signIn, signOut } from './auth'
import { useAuthStore } from '../stores/auth'

const DEMO_USER = { id: 'p-001', name: '张某某', username: null }
const REAL_USER = { id: 'u-1', name: '演示账号', username: 'g7-live' }

const storage = {
  load: vi.fn<() => Promise<string | null>>(),
  save: vi.fn<(token: string) => Promise<void>>(),
  clear: vi.fn<() => Promise<void>>(),
}

beforeEach(() => {
  vi.clearAllMocks()
  storage.load.mockResolvedValue(null)
  storage.save.mockResolvedValue(undefined)
  storage.clear.mockResolvedValue(undefined)
  setAuthTokenStorage(storage)
  useAuthStore.setState({ status: 'idle', mode: null, user: null, error: null })
})

afterEach(() => {
  setAuthTokenStorage(null)
  useAuthStore.setState({ status: 'idle', mode: null, user: null, error: null })
})

describe('bootstrapAuth · 启动恢复', () => {
  it('demo 模式无 token → 直接 authenticated（不出现登录页）', async () => {
    mocks.fetchAuthMe.mockResolvedValue({ ok: true, mode: 'demo', user: DEMO_USER })
    await bootstrapAuth()
    expect(storage.load).toHaveBeenCalled()
    expect(mocks.setAuthToken).not.toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().mode).toBe('demo')
    expect(useAuthStore.getState().user).toEqual(DEMO_USER)
  })

  it('持久化 token → 注入 Bearer 后 authenticated', async () => {
    storage.load.mockResolvedValue('saved-token')
    mocks.fetchAuthMe.mockResolvedValue({ ok: true, mode: 'password', user: REAL_USER })
    await bootstrapAuth()
    expect(mocks.setAuthToken).toHaveBeenCalledWith('saved-token')
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().user).toEqual(REAL_USER)
  })

  it('401 → 清本地 token，状态 anonymous（交给路由守卫跳登录）', async () => {
    storage.load.mockResolvedValue('expired-token')
    mocks.fetchAuthMe.mockRejectedValue(new ApiRequestError('登录已失效，请重新登录', 'AUTH_INVALID', 401))
    await bootstrapAuth()
    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(storage.clear).toHaveBeenCalled()
    expect(mocks.setAuthToken).toHaveBeenLastCalledWith(null)
  })

  it('网络/服务异常 → error 状态（不静默当未登录）', async () => {
    mocks.fetchAuthMe.mockRejectedValue(new Error('Failed to fetch'))
    await bootstrapAuth()
    expect(useAuthStore.getState().status).toBe('error')
    expect(useAuthStore.getState().error).toContain('Failed to fetch')
    expect(storage.clear).not.toHaveBeenCalled()
  })

  it('幂等：已登录时重复调用不再请求', async () => {
    useAuthStore.setState({ status: 'authenticated', mode: 'password', user: REAL_USER, error: null })
    await bootstrapAuth()
    expect(mocks.fetchAuthMe).not.toHaveBeenCalled()
  })
})

describe('signIn / signOut', () => {
  it('登录成功 → 持久化 token + authenticated', async () => {
    mocks.loginWithPassword.mockResolvedValue({ ok: true, mode: 'password', token: 'fresh-token', user: REAL_USER })
    await signIn('g7-live', 'pass-123')
    expect(mocks.loginWithPassword).toHaveBeenCalledWith('g7-live', 'pass-123')
    expect(storage.save).toHaveBeenCalledWith('fresh-token')
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('登录失败 → 状态不变、错误原样抛给登录页', async () => {
    mocks.loginWithPassword.mockRejectedValue(new ApiRequestError('账号或密码错误', 'AUTH_INVALID', 401))
    await expect(signIn('g7-live', 'wrong')).rejects.toThrow('账号或密码错误')
    expect(storage.save).not.toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('idle')
  })

  it('退出登录 → 调 logout、清持久化与内存态', async () => {
    useAuthStore.setState({ status: 'authenticated', mode: 'password', user: REAL_USER, error: null })
    mocks.logoutSession.mockResolvedValue(undefined)
    await signOut()
    expect(mocks.logoutSession).toHaveBeenCalled()
    expect(storage.clear).toHaveBeenCalled()
    expect(mocks.setAuthToken).toHaveBeenLastCalledWith(null)
    expect(useAuthStore.getState().status).toBe('anonymous')
  })
})
