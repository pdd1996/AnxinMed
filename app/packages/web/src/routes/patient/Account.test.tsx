/**
 * 个人资料页（G8 增补）组件测试：姓名校验、成功保存后回「我的」、失败内联可见。
 * 只 mock core 的 updateDisplayName 与 sonner，store 与 shared 契约走真代码
 * （校验规则来自 UpdateMeRequestSchema，与服务端同一份）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ApiRequestError, useAuthStore } from '@anxin/core'
import { DISPLAY_NAME_MAX_LENGTH } from '@anxin/shared'
import Account from './Account'

const mocks = vi.hoisted(() => ({ updateDisplayName: vi.fn(), success: vi.fn() }))

vi.mock('@anxin/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anxin/core')>()
  return { ...actual, updateDisplayName: mocks.updateDisplayName }
})
vi.mock('sonner', () => ({ toast: { success: mocks.success } }))

const USER = { id: 'p-001', name: '张某某', username: null }

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
