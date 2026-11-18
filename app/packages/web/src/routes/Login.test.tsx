/**
 * 登录页（G7 密码 · P1 手机号验证码）组件测试：
 * 密码：表单校验、提交 trim、失败文案内联、pending 防重复；
 * 手机号：tab 切换、发码校验/落款提示/倒计时禁用、提交 trim、验证码错误内联。
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
}))
vi.mock('@anxin/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anxin/core')>()
  return {
    ...actual,
    signIn: mocks.signIn,
    requestPhoneCode: mocks.requestPhoneCode,
    signInWithPhone: mocks.signInWithPhone,
  }
})

function renderLogin() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>,
  )
}

function fillAndSubmit(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('账号'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
}

function switchToPhoneTab() {
  fireEvent.click(screen.getByRole('tab', { name: '手机号登录' }))
}

beforeEach(() => {
  mocks.signIn.mockReset()
  mocks.requestPhoneCode.mockReset()
  mocks.signInWithPhone.mockReset()
  useAuthStore.setState({ status: 'anonymous', mode: null, user: null, error: null })
})
afterEach(() => {
  cleanup()
  useAuthStore.setState({ status: 'idle', mode: null, user: null, error: null })
})

describe('Login 页 · 账号密码登录', () => {
  it('提交时账号 trim 后交给 signIn', async () => {
    mocks.signIn.mockResolvedValue(undefined)
    renderLogin()
    fillAndSubmit('  demo-user  ', 'secret-123')
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith('demo-user', 'secret-123'))
  })

  it('登录失败 → 内联展示服务端可读文案，按钮恢复可点', async () => {
    mocks.signIn.mockRejectedValue(new ApiRequestError('账号或密码错误', 'AUTH_INVALID', 401))
    renderLogin()
    fillAndSubmit('demo-user', 'wrong')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('账号或密码错误')
    expect((screen.getByRole('button', { name: '登录' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('限流失败 → 展示 429 返回的文案', async () => {
    mocks.signIn.mockRejectedValue(
      new ApiRequestError('登录尝试次数过多，请 15 分钟后再试', 'AUTH_LOCKED', 429),
    )
    renderLogin()
    fillAndSubmit('demo-user', 'wrong')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('登录尝试次数过多')
  })

  it('断网/网络层异常 → 展示中文「网络连接失败」，不把英文技术串上屏', async () => {
    mocks.signIn.mockRejectedValue(new TypeError('Failed to fetch'))
    renderLogin()
    fillAndSubmit('demo-user', 'secret-123')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('网络连接失败，请检查网络后重试')
    expect(alert.textContent).not.toContain('Failed to fetch')
  })

  it('英文服务异常（500）→ 展示中文「服务暂时不可用」', async () => {
    mocks.signIn.mockRejectedValue(new ApiRequestError('Internal Server Error', undefined, 500))
    renderLogin()
    fillAndSubmit('demo-user', 'secret-123')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('服务暂时不可用，请稍后重试')
    expect(alert.textContent).not.toContain('Internal Server Error')
  })

  it('空表单提交 → 不请求接口，提示请输入账号和密码', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect((await screen.findByRole('alert')).textContent).toContain('请输入账号和密码')
    expect(mocks.signIn).not.toHaveBeenCalled()
  })
})

describe('Login 页 · 手机号验证码登录/注册（P1）', () => {
  it('切到手机号 tab → 显示手机号/验证码表单；空提交不发请求并提示手机号', async () => {
    renderLogin()
    switchToPhoneTab()

    expect(screen.getByLabelText('手机号')).toBeTruthy()
    expect(screen.getByLabelText('短信验证码')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '登录 / 注册' }))
    expect((await screen.findByRole('alert')).textContent).toContain('请输入 11 位手机号')
    expect(mocks.signInWithPhone).not.toHaveBeenCalled()
  })

  it('获取验证码：手机号非法 → 提示且不请求接口', async () => {
    renderLogin()
    switchToPhoneTab()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '12345' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    expect((await screen.findByRole('alert')).textContent).toContain('请输入 11 位手机号')
    expect(mocks.requestPhoneCode).not.toHaveBeenCalled()
  })

  it('获取验证码成功 → 展示短信落款提示并进入冷却（按钮禁用、显示倒计时）', async () => {
    mocks.requestPhoneCode.mockResolvedValue({
      ok: true,
      mode: 'password',
      cooldownSec: 60,
      expiresInSec: 300,
      signName: '恒创联众',
    })
    renderLogin()
    switchToPhoneTab()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    await waitFor(() => expect(mocks.requestPhoneCode).toHaveBeenCalledWith('13800138000'))
    expect((await screen.findByText(/短信落款为「恒创联众」/)).textContent).toContain('请注意查收')
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
    switchToPhoneTab()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))

    expect((await screen.findByRole('alert')).textContent).toContain('验证码发送太频繁')
  })

  it('提交登录/注册：手机号与验证码 trim 后交给 signInWithPhone', async () => {
    mocks.signInWithPhone.mockResolvedValue({ created: true })
    renderLogin()
    switchToPhoneTab()
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
    switchToPhoneTab()
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
    switchToPhoneTab()
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.click(screen.getByRole('button', { name: '登录 / 注册' }))

    expect((await screen.findByRole('alert')).textContent).toContain('请输入短信验证码')
    expect(mocks.signInWithPhone).not.toHaveBeenCalled()
  })
})
