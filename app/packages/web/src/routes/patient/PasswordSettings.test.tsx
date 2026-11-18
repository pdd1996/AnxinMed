/**
 * 登录密码页（P1 · 设置 → 账号与安全 → 登录密码）组件测试：
 * 设置/修改文案切换、最小长度与二次确认校验、成功后调用与提示、旧密码错误内联、返回设置页。
 * 只 mock core 的 updatePassword 与 sonner，store 与 shared 契约走真代码。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ApiRequestError, useAuthStore } from '@anxin/core'
import { PASSWORD_MIN_LENGTH } from '@anxin/shared'
import PasswordSettings from './PasswordSettings'

const mocks = vi.hoisted(() => ({ updatePassword: vi.fn(), success: vi.fn() }))

vi.mock('@anxin/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anxin/core')>()
  return { ...actual, updatePassword: mocks.updatePassword }
})
vi.mock('sonner', () => ({ toast: { success: mocks.success } }))

const PHONE_USER = { id: 'u-1', name: '张某某', username: null, hasPassword: false }
const PASSWORD_USER = { id: 'u-2', name: '张某某', username: '15167179657', hasPassword: true }

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/settings/password']}>
      <Routes>
        <Route path="/settings/password" element={<PasswordSettings />} />
        <Route path="/settings" element={<p>设置页</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function useMode(user: typeof PHONE_USER | typeof PASSWORD_USER) {
  useAuthStore.setState({ status: 'authenticated', mode: 'password', user, error: null })
}

function fillPassword(input: { old?: string; next: string; confirm: string }) {
  if (input.old !== undefined) {
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: input.old } })
  }
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: input.next } })
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: input.confirm } })
}

beforeEach(() => {
  mocks.updatePassword.mockReset()
  mocks.success.mockReset()
  useMode(PHONE_USER)
})

afterEach(() => {
  cleanup()
  useAuthStore.setState({ status: 'idle', mode: null, user: null, error: null })
})

describe('PasswordSettings 页 · 设置/修改登录密码', () => {
  it('页头有返回「设置」入口', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /返回/ }).getAttribute('href')).toBe('/settings')
  })

  it('手机号账号无密码 → 不显示「当前密码」，按钮为「设置密码」', () => {
    renderPage()

    expect(screen.getByText('登录密码')).toBeTruthy()
    expect(screen.queryByLabelText('当前密码')).toBeNull()
    expect(screen.getByRole('button', { name: '设置密码' })).toBeTruthy()
    expect(screen.getByText(/手机号注册的账号还没有密码/)).toBeTruthy()
  })

  it('两次输入不一致 → 内联提示，不请求接口', async () => {
    renderPage()
    fillPassword({ next: 'newpass123', confirm: 'newpass456' })
    fireEvent.click(screen.getByRole('button', { name: '设置密码' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('两次输入的密码不一致')
    expect(mocks.updatePassword).not.toHaveBeenCalled()
  })

  it('新密码过短 → 复用 shared 契约提示「至少 N 位」，不请求接口', async () => {
    renderPage()
    const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1)
    fillPassword({ next: short, confirm: short })
    fireEvent.click(screen.getByRole('button', { name: '设置密码' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(`至少 ${PASSWORD_MIN_LENGTH} 位`)
    expect(mocks.updatePassword).not.toHaveBeenCalled()
  })

  it('设置成功 → 无旧密码调用 updatePassword、提示成功、清空输入', async () => {
    mocks.updatePassword.mockResolvedValue(undefined)
    renderPage()
    fillPassword({ next: 'newpass123', confirm: 'newpass123' })
    fireEvent.click(screen.getByRole('button', { name: '设置密码' }))

    await waitFor(() => expect(mocks.updatePassword).toHaveBeenCalledWith(undefined, 'newpass123'))
    expect(mocks.success).toHaveBeenCalledWith('密码已设置，可用「手机号 + 密码」登录')
    expect((screen.getByLabelText('新密码') as HTMLInputElement).value).toBe('')
  })

  it('已有密码 → 显示「当前密码」与「修改密码」；旧密码错误 → 内联服务端文案', async () => {
    useMode(PASSWORD_USER)
    mocks.updatePassword.mockRejectedValue(
      new ApiRequestError('当前密码不正确', 'AUTH_PASSWORD_INVALID', 400),
    )
    renderPage()

    expect(screen.getByLabelText('当前密码')).toBeTruthy()
    fillPassword({ old: 'wrong-pass', next: 'newpass123', confirm: 'newpass123' })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    await waitFor(() => expect(mocks.updatePassword).toHaveBeenCalledWith('wrong-pass', 'newpass123'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('当前密码不正确')
    expect((screen.getByRole('button', { name: '修改密码' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
