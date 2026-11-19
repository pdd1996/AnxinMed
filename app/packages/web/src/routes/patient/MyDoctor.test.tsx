/**
 * 「我的医生」独立页（specs/25 患者端入口调整）组件测试：
 * 页头/返回、password 模式渲染绑定卡片（未绑定时直接给绑定码输入、已绑定时输入收起）、
 * 核销绑定码成功文案、demo 模式说明卡（不渲染绑定输入）。
 * 只 mock core 的传输层 fetchMyDoctors / redeemBindCode / unbindDoctor，
 * toUserMessage 等其余导出走真代码（参考 Records.test.tsx / PasswordSettings.test.tsx）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@anxin/core'
import MyDoctor from './MyDoctor'

const mocks = vi.hoisted(() => ({
  fetchMyDoctors: vi.fn(),
  redeemBindCode: vi.fn(),
  unbindDoctor: vi.fn(),
}))

vi.mock('@anxin/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anxin/core')>()
  return { ...actual, ...mocks } // 只替换传输层函数，store / toUserMessage 等走真代码
})

const DOCTOR = { id: 'doctor-demo', name: '李医生', boundAt: '2026-11-19T10:00:00.000Z' }

function renderMyDoctor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/my-doctor']}>
        <Routes>
          <Route path="/my-doctor" element={<MyDoctor />} />
          <Route path="/profile" element={<p>我的页</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function useMode(mode: 'demo' | 'password') {
  useAuthStore.setState({
    status: 'authenticated',
    mode,
    user: { id: 'p-001', name: '张某某', username: null },
    error: null,
  })
}

beforeEach(() => {
  mocks.fetchMyDoctors.mockReset()
  mocks.redeemBindCode.mockReset()
  mocks.unbindDoctor.mockReset()
  mocks.fetchMyDoctors.mockResolvedValue([])
  useMode('password')
})

afterEach(() => {
  cleanup()
  useAuthStore.setState({ status: 'idle', mode: null, user: null, error: null })
})

describe('MyDoctor 页 · 页头与绑定卡片', () => {
  it('页头有「我的医生」标题与返回「我的」入口', async () => {
    renderMyDoctor()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('我的医生')
    expect(screen.getByRole('link', { name: /返回/ }).getAttribute('href')).toBe('/profile')
    await waitFor(() => expect(mocks.fetchMyDoctors).toHaveBeenCalled())
  })

  it('password 模式：出现「输入绑定码」输入框与「绑定」按钮', async () => {
    renderMyDoctor()
    expect(await screen.findByLabelText('输入绑定码')).toBeTruthy()
    expect(screen.getByRole('button', { name: '绑定' })).toBeTruthy()
  })

  it('已绑定医生 → 显示医生姓名与「解绑」按钮', async () => {
    mocks.fetchMyDoctors.mockResolvedValue([DOCTOR])
    renderMyDoctor()
    expect(await screen.findByText('李医生')).toBeTruthy()
    expect(screen.getByRole('button', { name: '解绑' })).toBeTruthy()
  })

  it('已绑定医生：绑定码输入默认收起，点「绑定其他医生」才展开、可取消', async () => {
    mocks.fetchMyDoctors.mockResolvedValue([DOCTOR])
    renderMyDoctor()
    expect(await screen.findByText('李医生')).toBeTruthy()
    // 已授权状态下不再常驻「输入绑定码」，避免「已经绑好了为什么还让我输码」的误解。
    expect(screen.queryByLabelText('输入绑定码')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /绑定其他医生/ }))
    expect(await screen.findByLabelText('输入绑定码')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByLabelText('输入绑定码')).toBeNull()
  })

  it('输入 6 位绑定码点「绑定」→ 调 redeemBindCode 并展示成功文案', async () => {
    mocks.redeemBindCode.mockResolvedValue({ ...DOCTOR, boundAt: new Date().toISOString() })
    renderMyDoctor()
    const input = await screen.findByLabelText('输入绑定码')
    fireEvent.change(input, { target: { value: '604035' } })
    fireEvent.click(screen.getByRole('button', { name: '绑定' }))

    await waitFor(() => expect(mocks.redeemBindCode).toHaveBeenCalledWith('604035'))
    expect(await screen.findByText(/绑定成功/)).toBeTruthy()
    expect(mocks.unbindDoctor).not.toHaveBeenCalled()
  })
})

describe('MyDoctor 页 · demo 模式', () => {
  it('显示演示模式说明，不渲染绑定输入', () => {
    useMode('demo')
    renderMyDoctor()
    expect(screen.getByText(/演示模式/)).toBeTruthy()
    expect(screen.queryByLabelText('输入绑定码')).toBeNull()
    expect(screen.queryByRole('button', { name: '绑定' })).toBeNull()
  })
})
