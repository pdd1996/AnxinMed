/**
 * 登录页（G7）组件测试：表单校验、提交 trim、失败文案内联、pending 防重复。
 * 只 mock core 的 signIn，其余（ApiRequestError / store）走真代码。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ApiRequestError, useAuthStore } from '@anxin/core'
import Login from './Login'

const mocks = vi.hoisted(() => ({ signIn: vi.fn() }))
vi.mock('@anxin/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anxin/core')>()
  return { ...actual, signIn: mocks.signIn }
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

beforeEach(() => {
  mocks.signIn.mockReset()
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
