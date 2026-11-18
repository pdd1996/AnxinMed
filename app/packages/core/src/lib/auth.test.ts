/**
 * 登录流程编排（G7）单元测试：启动恢复 / 平台存储 / 401 清态 / 登录登出。
 * 只 mock 传输层与 token 注入，store 与状态机走真代码。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchAuthMe: vi.fn(),
  loginWithPassword: vi.fn(),
  loginWithPhone: vi.fn(),
  logoutSession: vi.fn(),
  requestPasswordResetCode: vi.fn(),
  requestPhoneLoginCode: vi.fn(),
  resetPasswordWithCode: vi.fn(),
  setAccountPassword: vi.fn(),
  setAuthToken: vi.fn(),
}))

vi.mock('../api/auth', () => ({
  fetchAuthMe: mocks.fetchAuthMe,
  loginWithPassword: mocks.loginWithPassword,
  loginWithPhone: mocks.loginWithPhone,
  logoutSession: mocks.logoutSession,
  requestPasswordResetCode: mocks.requestPasswordResetCode,
  requestPhoneLoginCode: mocks.requestPhoneLoginCode,
  resetPasswordWithCode: mocks.resetPasswordWithCode,
  setAccountPassword: mocks.setAccountPassword,
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
import {
  bootstrapAuth,
  requestPhoneCode,
  requestResetCode,
  resetPassword,
  setAuthTokenStorage,
  signIn,
  signInWithPhone,
  signOut,
  updatePassword,
} from './auth'
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

  it('网络异常 → error 状态，store 里是中文文案（不静默当未登录，也不露英文技术串）', async () => {
    mocks.fetchAuthMe.mockRejectedValue(new TypeError('Failed to fetch'))
    await bootstrapAuth()
    expect(useAuthStore.getState().status).toBe('error')
    expect(useAuthStore.getState().error).toBe('网络连接失败，请检查网络后重试')
    expect(useAuthStore.getState().error).not.toContain('Failed to fetch')
    expect(storage.clear).not.toHaveBeenCalled()
  })

  it('英文服务异常（500）→ error 状态展示中文「服务暂时不可用」', async () => {
    mocks.fetchAuthMe.mockRejectedValue(new ApiRequestError('Internal Server Error', undefined, 500))
    await bootstrapAuth()
    expect(useAuthStore.getState().status).toBe('error')
    expect(useAuthStore.getState().error).toBe('服务暂时不可用，请稍后重试')
  })

  it('无法归类的异常 → 中文兜底「登录状态检查失败，请重试」', async () => {
    mocks.fetchAuthMe.mockRejectedValue(new Error('boom'))
    await bootstrapAuth()
    expect(useAuthStore.getState().status).toBe('error')
    expect(useAuthStore.getState().error).toBe('登录状态检查失败，请重试')
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

describe('手机号验证码登录（P1）', () => {
  it('requestPhoneCode → 透传发码结果（冷却/有效期/短信落款），供登录页倒计时与防诈骗提示', async () => {
    const payload = {
      ok: true,
      mode: 'password',
      cooldownSec: 60,
      expiresInSec: 300,
      signName: '恒创联众',
    }
    mocks.requestPhoneLoginCode.mockResolvedValue(payload)

    await expect(requestPhoneCode('13800138000')).resolves.toEqual(payload)
    expect(mocks.requestPhoneLoginCode).toHaveBeenCalledWith('13800138000')
  })

  it('signInWithPhone 成功 → 持久化 token + authenticated，返回 created（是否自动注册）', async () => {
    mocks.loginWithPhone.mockResolvedValue({
      ok: true,
      mode: 'password',
      token: 'phone-token',
      user: REAL_USER,
      created: true,
    })

    await expect(signInWithPhone('13800138000', '123456')).resolves.toEqual({ created: true })
    expect(mocks.loginWithPhone).toHaveBeenCalledWith('13800138000', '123456')
    expect(storage.save).toHaveBeenCalledWith('phone-token')
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().user).toEqual(REAL_USER)
  })

  it('验证码错误 → 状态不变、错误原样抛给登录页（不吞错、不假装登录成功）', async () => {
    mocks.loginWithPhone.mockRejectedValue(
      new ApiRequestError('验证码错误或已过期，请重新获取', 'AUTH_CODE_INVALID', 401),
    )

    await expect(signInWithPhone('13800138000', '000000')).rejects.toThrow('验证码错误或已过期')
    expect(storage.save).not.toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('idle')
  })
})

describe('设置 / 修改密码（P1 增补）', () => {
  it('无密码账号设置成功 → 用返回 user 覆盖登录态（hasPassword 变 true）', async () => {
    mocks.setAccountPassword.mockResolvedValue({
      ok: true,
      mode: 'password',
      user: { ...REAL_USER, hasPassword: true },
    })

    await updatePassword(undefined, 'newpass123')

    expect(mocks.setAccountPassword).toHaveBeenCalledWith({ password: 'newpass123' })
    expect(useAuthStore.getState().user?.hasPassword).toBe(true)
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('已有密码改密 → 带 oldPassword；当前密码错误原样抛给页面（不清登录态）', async () => {
    mocks.setAccountPassword.mockResolvedValue({
      ok: true,
      mode: 'password',
      user: { ...REAL_USER, hasPassword: true },
    })
    await updatePassword('old-pass', 'newpass123')
    expect(mocks.setAccountPassword).toHaveBeenCalledWith({
      oldPassword: 'old-pass',
      password: 'newpass123',
    })

    useAuthStore.setState({ status: 'authenticated', mode: 'password', user: REAL_USER, error: null })
    mocks.setAccountPassword.mockRejectedValue(
      new ApiRequestError('当前密码不正确', 'AUTH_PASSWORD_INVALID', 400),
    )
    await expect(updatePassword('wrong-pass', 'newpass456')).rejects.toThrow('当前密码不正确')
    // 400 不是 401：登录态保持不变（页面内联提示即可）
    expect(useAuthStore.getState().status).toBe('authenticated')
  })
})

describe('未登录「忘记密码」自助找回（P1 增补）', () => {
  it('requestResetCode → 透传发码结果（统一形态，未注册号也成功）', async () => {
    const payload = {
      ok: true,
      mode: 'password',
      cooldownSec: 60,
      expiresInSec: 300,
      signName: '恒创联众',
    }
    mocks.requestPasswordResetCode.mockResolvedValue(payload)

    await expect(requestResetCode('13600001111')).resolves.toEqual(payload)
    expect(mocks.requestPasswordResetCode).toHaveBeenCalledWith('13600001111')
  })

  it('resetPassword 成功 → 写 token 持久化并 authenticated（重置即登录）', async () => {
    mocks.resetPasswordWithCode.mockResolvedValue({
      ok: true,
      mode: 'password',
      token: 'reset-token',
      user: { ...REAL_USER, hasPassword: true },
    })

    await resetPassword('13600001111', '123456', 'New-pass-456')

    expect(mocks.resetPasswordWithCode).toHaveBeenCalledWith('13600001111', '123456', 'New-pass-456')
    expect(storage.save).toHaveBeenCalledWith('reset-token')
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().user?.hasPassword).toBe(true)
  })

  it('验证码错误 → 状态不变、错误原样抛给登录页', async () => {
    mocks.resetPasswordWithCode.mockRejectedValue(
      new ApiRequestError('验证码错误或已过期，请重新获取', 'AUTH_CODE_INVALID', 401),
    )

    await expect(resetPassword('13600001111', '000000', 'New-pass-456')).rejects.toThrow(
      '验证码错误或已过期',
    )
    expect(storage.save).not.toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('idle')
  })
})
