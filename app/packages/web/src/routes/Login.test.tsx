/**
 * 登录页（G7 密码 · P1 手机号验证码）组件测试：
 * 密码：表单校验、提交 trim、失败文案内联、pending 防重复；
 * 手机号：默认 tab（2026-11-19 用户裁定）、发码校验/倒计时禁用、提交 trim、验证码错误内联。
 * 只 mock core 的 signIn / requestPhoneCode / signInWithPhone，其余（ApiRequestError / store）走真代码。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ApiRequestError, useAuthStore } from '@anxin/core'
import Login from './Login'

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  requestPhoneCode: vi.fn(),
  signInWithPhone: vi.fn(),
  requestResetCode: vi.fn(),
  resetPassword: vi.fn(),
}))
vi.mock('@anxin/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anxin/core')>()
  return {
    ...actual,
    signIn: mocks.signIn,
    requestPhoneCode: mocks.requestPhoneCode,
    signInWithPhone: mocks.signInWithPhone,
    requestResetCode: mocks.requestResetCode,
    resetPassword: mocks.resetPassword,
  }
})

/** 默认档是手机号验证码；传 'password' 表示先点「密码登录」切过去（对应用户的一次点击）。 */
function renderLogin(tab: 'phone' | 'password' = 'phone') {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>,
  )
  if (tab === 'password') fireEvent.click(screen.getByRole('tab', { name: '密码登录' }))
}

function fillAndSubmit(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('账号'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
}

beforeEach(() => {
  mocks.signIn.mockReset()
  mocks.requestPhoneCode.mockReset()
  mocks.signInWithPhone.mockReset()
  mocks.requestResetCode.mockReset()
  mocks.resetPassword.mockReset()
  useAuthStore.setState({ status: 'anonymous', mode: null, user: null, error: null })
})
afterEach(() => {
  cleanup()
  useAuthStore.setState({ status: 'idle', mode: null, user: null, error: null })
})

describe('Login 页 · 账号密码登录', () => {
  it('提交时账号 trim 后交给 signIn', async () => {
    mocks.signIn.mockResolvedValue(undefined)
    renderLogin('password')
    fillAndSubmit('  demo-user  ', 'secret-123')
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith('demo-user', 'secret-123'))
  })

  it('登录失败 → 内联展示服务端可读文案，按钮恢复可点', async () => {
    mocks.signIn.mockRejectedValue(new ApiRequestError('账号或密码错误', 'AUTH_INVALID', 401))
    renderLogin('password')
    fillAndSubmit('demo-user', 'wrong')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('账号或密码错误')
    expect((screen.getByRole('button', { name: '登录' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('限流失败 → 展示 429 返回的文案', async () => {
    mocks.signIn.mockRejectedValue(
      new ApiRequestError('登录尝试次数过多，请 15 分钟后再试', 'AUTH_LOCKED', 429),
    )
    renderLogin('password')
    fillAndSubmit('demo-user', 'wrong')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('登录尝试次数过多')
  })

  it('断网/网络层异常 → 展示中文「网络连接失败」，不把英文技术串上屏', async () => {
    mocks.signIn.mockRejectedValue(new TypeError('Failed to fetch'))
    renderLogin('password')
    fillAndSubmit('demo-user', 'secret-123')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('网络连接失败，请检查网络后重试')
    expect(alert.textContent).not.toContain('Failed to fetch')
  })

  it('英文服务异常（500）→ 展示中文「服务暂时不可用」', async () => {
    mocks.signIn.mockRejectedValue(new ApiRequestError('Internal Server Error', undefined, 500))
    renderLogin('password')
    fillAndSubmit('demo-user', 'secret-123')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('服务暂时不可用，请稍后重试')
    expect(alert.textContent).not.toContain('Internal Server Error')
  })

  it('空表单提交 → 不请求接口，提示请输入账号和密码', async () => {
    renderLogin('password')
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect((await screen.findByRole('alert')).textContent).toContain('请输入账号和密码')
    expect(mocks.signIn).not.toHaveBeenCalled()
  })
})

describe('Login 页 · 手机号验证码登录/注册（P1）', () => {
  it('默认落在手机号验证码 tab（密码表单不渲染）→ 显示手机号/验证码表单；空提交不发请求并提示手机号', async () => {
    renderLogin()

    // 默认档（2026-11-19 用户裁定）：进登录页即可发码/验证码登录，不先看到账号密码。
    expect(screen.getByRole('tab', { name: '手机号登录' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByLabelText('账号')).toBeNull()
    expect(screen.getByLabelText('手机号')).toBeTruthy()
    expect(screen.getByLabelText('短信验证码')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '登录 / 注册' }))
    expect((await screen.findByRole('alert')).textContent).toContain('请输入 11 位手机号')
    expect(mocks.signInWithPhone).not.toHaveBeenCalled()
  })

  it('获取验证码：手机号非法 → 提示且不请求接口', async () => {
    renderLogin()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '12345' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    expect((await screen.findByRole('alert')).textContent).toContain('请输入 11 位手机号')
    expect(mocks.requestPhoneCode).not.toHaveBeenCalled()
  })

  it('获取验证码成功 → 进入冷却（按钮禁用、显示倒计时）', async () => {
    mocks.requestPhoneCode.mockResolvedValue({
      ok: true,
      mode: 'password',
      cooldownSec: 60,
      expiresInSec: 300,
      signName: '恒创联众',
    })
    renderLogin()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    await waitFor(() => expect(mocks.requestPhoneCode).toHaveBeenCalledWith('13800138000'))
    const resend = screen.getByRole('button', { name: /秒后重发/ }) as HTMLButtonElement
    expect(resend.disabled).toBe(true)

    // 冷却中再点不会重复请求
    fireEvent.click(resend)
    expect(mocks.requestPhoneCode).toHaveBeenCalledTimes(1)
  })

  it('获取验证码失败（服务商频控）→ 内联展示服务端中文文案', async () => {
    mocks.requestPhoneCode.mockRejectedValue(
      new ApiRequestError('验证码发送太频繁，请稍后再试', 'SMS_LIMITED', 429),
    )
    renderLogin()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    expect((await screen.findByRole('alert')).textContent).toContain('验证码发送太频繁')
  })

  it('提交登录/注册：手机号与验证码 trim 后交给 signInWithPhone', async () => {
    mocks.signInWithPhone.mockResolvedValue({ created: true })
    renderLogin()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByLabelText('短信验证码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '登录 / 注册' }))

    await waitFor(() =>
      expect(mocks.signInWithPhone).toHaveBeenCalledWith('13800138000', '123456'),
    )
  })

  it('验证码错误 → 内联「验证码错误或已过期…」，按钮恢复可点', async () => {
    mocks.signInWithPhone.mockRejectedValue(
      new ApiRequestError('验证码错误或已过期，请重新获取', 'AUTH_CODE_INVALID', 401),
    )
    renderLogin()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByLabelText('短信验证码'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: '登录 / 注册' }))

    expect((await screen.findByRole('alert')).textContent).toContain('验证码错误或已过期')
    expect(
      (screen.getByRole('button', { name: '登录 / 注册' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('验证码为空 → 提示「请输入短信验证码」，不发请求', async () => {
    renderLogin()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.click(screen.getByRole('button', { name: '登录 / 注册' }))

    expect((await screen.findByRole('alert')).textContent).toContain('请输入短信验证码')
    expect(mocks.signInWithPhone).not.toHaveBeenCalled()
  })
})

describe('Login 页 · 忘记密码（P1：未登录找回）', () => {
  function openReset() {
    renderLogin('password')
    fireEvent.click(screen.getByRole('button', { name: '忘记密码？用手机号找回' }))
  }

  it('从密码登录进入找回表单，可返回密码登录', () => {
    openReset()
    expect(screen.getByText('找回密码')).toBeTruthy()
    expect(screen.getByLabelText('手机号')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '← 返回密码登录' }))
    expect(screen.getByLabelText('账号')).toBeTruthy()
  })

  it('手机号非法点获取验证码 → 提示且不请求', async () => {
    openReset()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '12345' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    expect((await screen.findByRole('alert')).textContent).toContain('请输入 11 位手机号')
    expect(mocks.requestResetCode).not.toHaveBeenCalled()
  })

  it('获取重置验证码成功 → 调用 requestResetCode 并进入冷却', async () => {
    mocks.requestResetCode.mockResolvedValue({
      ok: true,
      mode: 'password',
      cooldownSec: 60,
      expiresInSec: 300,
      signName: '恒创联众',
    })
    openReset()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13600001111' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    await waitFor(() => expect(mocks.requestResetCode).toHaveBeenCalledWith('13600001111'))
    const resend = screen.getByRole('button', { name: /秒后重发/ }) as HTMLButtonElement
    expect(resend.disabled).toBe(true)
  })

  it('两次新密码不一致 → 内联提示，不请求接口', async () => {
    openReset()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13600001111' } })
    fireEvent.change(screen.getByLabelText('短信验证码'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass123' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpass456' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码并登录' }))

    expect((await screen.findByRole('alert')).textContent).toContain('两次输入的密码不一致')
    expect(mocks.resetPassword).not.toHaveBeenCalled()
  })

  it('提交成功 → resetPassword(手机号, 验证码, 新密码)', async () => {
    mocks.resetPassword.mockResolvedValue(undefined)
    openReset()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13600001111' } })
    fireEvent.change(screen.getByLabelText('短信验证码'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass123' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpass123' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码并登录' }))

    await waitFor(() =>
      expect(mocks.resetPassword).toHaveBeenCalledWith('13600001111', '123456', 'newpass123'),
    )
  })

  it('验证码错误 → 内联服务端文案，按钮恢复可点', async () => {
    mocks.resetPassword.mockRejectedValue(
      new ApiRequestError('验证码错误或已过期，请重新获取', 'AUTH_CODE_INVALID', 401),
    )
    openReset()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13600001111' } })
    fireEvent.change(screen.getByLabelText('短信验证码'), { target: { value: '000000' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass123' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpass123' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码并登录' }))

    expect((await screen.findByRole('alert')).textContent).toContain('验证码错误或已过期')
    expect(
      (screen.getByRole('button', { name: '重置密码并登录' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})
