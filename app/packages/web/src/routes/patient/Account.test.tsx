/**
 * 个人资料页（G8 姓名 + P1 登录密码）组件测试：姓名校验、保存回「我的」、失败内联；
 * 密码：设置/修改文案切换、最小长度与二次确认校验、成功后调用与提示、旧密码错误内联。
 * 只 mock core 的写接口与 sonner，store 与 shared 契约走真代码。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ApiRequestError, useAuthStore } from '@anxin/core'
import { DISPLAY_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@anxin/shared'
import Account from './Account'

const mocks = vi.hoisted(() => ({
  updateDisplayName: vi.fn(),
  updatePassword: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@anxin/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anxin/core')>()
  return { ...actual, updateDisplayName: mocks.updateDisplayName, updatePassword: mocks.updatePassword }
})
vi.mock('sonner', () => ({ toast: { success: mocks.success } }))

const USER = { id: 'p-001', name: '张某某', username: null }
const PHONE_USER = { id: 'u-1', name: '张某某', username: null, hasPassword: false }
const PASSWORD_USER = { id: 'u-2', name: '张某某', username: 'demo01', hasPassword: true }

function renderAccount() {
  render(
    <MemoryRouter initialEntries={['/account']}>
      <Routes>
        <Route path="/account" element={<Account />} />
        <Route path="/profile" element={<p>我的页</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function typeName(value: string) {
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value } })
}

function saveButton() {
  return screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement
}

beforeEach(() => {
  mocks.updateDisplayName.mockReset()
  mocks.updatePassword.mockReset()
  mocks.success.mockReset()
  useAuthStore.setState({ status: 'authenticated', mode: 'demo', user: USER, error: null })
})

afterEach(() => {
  cleanup()
  useAuthStore.setState({ status: 'idle', mode: null, user: null, error: null })
})

describe('Account 页 · 改姓名', () => {
  it('页头有返回「我的」入口（二级页不在底部 tab 的 active 前缀内）', () => {
    renderAccount()
    expect(screen.getByRole('link', { name: /返回/ }).getAttribute('href')).toBe('/profile')
  })

  it('初始显示当前姓名；未改动时保存按钮禁用', () => {
    renderAccount()
    expect((screen.getByLabelText('姓名') as HTMLInputElement).value).toBe('张某某')
    expect(saveButton().disabled).toBe(true)
  })

  it('保存成功 → 提交 trim 后的姓名、提示成功并回到「我的」', async () => {
    mocks.updateDisplayName.mockResolvedValue(undefined)
    renderAccount()
    typeName('  张三  ')
    fireEvent.click(saveButton())

    await waitFor(() => expect(mocks.updateDisplayName).toHaveBeenCalledWith('张三'))
    expect(mocks.success).toHaveBeenCalled()
    expect(await screen.findByText('我的页')).toBeTruthy()
  })

  it('空名/全空格 → 内联提示「请输入姓名」，不请求接口', async () => {
    renderAccount()
    typeName('   ')
    fireEvent.click(saveButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('请输入姓名')
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
  })

  it('超长 → 内联提示最多 N 个字（复用 shared 契约的上限）', async () => {
    renderAccount()
    typeName('超'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))
    fireEvent.click(saveButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(String(DISPLAY_NAME_MAX_LENGTH))
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
  })

  it('服务端失败 → 文案留在表单里可见，不假装已保存', async () => {
    mocks.updateDisplayName.mockRejectedValue(new ApiRequestError('姓名最多 20 个字', 'VALIDATION', 400))
    renderAccount()
    typeName('李四')
    fireEvent.click(saveButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('姓名最多 20 个字')
    expect(screen.queryByText('我的页')).toBeNull()
    expect(saveButton().disabled).toBe(false)
  })
})

/** 切换到 password 模式的登录态（密码卡才渲染）。 */
function usePasswordMode(user: typeof PHONE_USER | typeof PASSWORD_USER) {
  useAuthStore.setState({ status: 'authenticated', mode: 'password', user, error: null })
}

function fillPassword(input: { old?: string; next: string; confirm: string }) {
  if (input.old !== undefined) {
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: input.old } })
  }
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: input.next } })
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: input.confirm } })
}

describe('Account 页 · 设置 / 修改密码（P1）', () => {
  it('demo 模式不渲染密码区（没有真实账号）', () => {
    renderAccount()
    expect(screen.queryByText('登录密码')).toBeNull()
  })

  it('手机号账号无密码 → 不显示「当前密码」，按钮文案为「设置密码」', () => {
    usePasswordMode(PHONE_USER)
    renderAccount()

    expect(screen.getByText('登录密码')).toBeTruthy()
    expect(screen.queryByLabelText('当前密码')).toBeNull()
    expect(screen.getByRole('button', { name: '设置密码' })).toBeTruthy()
    expect(screen.getByText(/手机号注册的账号还没有密码/)).toBeTruthy()
  })

  it('两次输入不一致 → 内联提示，不请求接口', async () => {
    usePasswordMode(PHONE_USER)
    renderAccount()
    fillPassword({ next: 'newpass123', confirm: 'newpass456' })
    fireEvent.click(screen.getByRole('button', { name: '设置密码' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('两次输入的密码不一致')
    expect(mocks.updatePassword).not.toHaveBeenCalled()
  })

  it('新密码过短 → 复用 shared 契约提示「至少 N 位」，不请求接口', async () => {
    usePasswordMode(PHONE_USER)
    renderAccount()
    const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1)
    fillPassword({ next: short, confirm: short })
    fireEvent.click(screen.getByRole('button', { name: '设置密码' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(`至少 ${PASSWORD_MIN_LENGTH} 位`)
    expect(mocks.updatePassword).not.toHaveBeenCalled()
  })

  it('设置成功 → 无旧密码调用 updatePassword、提示成功、清空输入', async () => {
    usePasswordMode(PHONE_USER)
    mocks.updatePassword.mockResolvedValue(undefined)
    renderAccount()
    fillPassword({ next: 'newpass123', confirm: 'newpass123' })
    fireEvent.click(screen.getByRole('button', { name: '设置密码' }))

    await waitFor(() => expect(mocks.updatePassword).toHaveBeenCalledWith(undefined, 'newpass123'))
    expect(mocks.success).toHaveBeenCalledWith('密码已设置，可用「手机号 + 密码」登录')
    expect((screen.getByLabelText('新密码') as HTMLInputElement).value).toBe('')
  })

  it('已有密码 → 显示「当前密码」与「修改密码」；旧密码错误 → 内联服务端文案', async () => {
    usePasswordMode(PASSWORD_USER)
    mocks.updatePassword.mockRejectedValue(
      new ApiRequestError('当前密码不正确', 'AUTH_PASSWORD_INVALID', 400),
    )
    renderAccount()

    expect(screen.getByLabelText('当前密码')).toBeTruthy()
    fillPassword({ old: 'wrong-pass', next: 'newpass123', confirm: 'newpass123' })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    await waitFor(() =>
      expect(mocks.updatePassword).toHaveBeenCalledWith('wrong-pass', 'newpass123'),
    )
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('当前密码不正确')
    expect((screen.getByRole('button', { name: '修改密码' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
