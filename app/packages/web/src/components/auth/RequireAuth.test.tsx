/**
 * 登录守卫（G7）状态分支测试：检查中 / 未登录跳登录页 / 已登录放行 / 检查失败给重试。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { useAuthStore } from '@anxin/core'
import { RequireAuth } from './RequireAuth'

vi.mock('@anxin/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anxin/core')>()
  return { ...actual, bootstrapAuth: vi.fn(async () => {}) }
})

function renderGate() {
  render(
    <MemoryRouter initialEntries={['/box']}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/box" element={<div>受保护内容</div>} />
        </Route>
        <Route path="/login" element={<div>登录页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  useAuthStore.setState({ status: 'idle', mode: null, user: null, error: null })
})

describe('RequireAuth · 登录守卫', () => {
  it('loading → 显示检查中，不闪现业务页', () => {
    useAuthStore.setState({ status: 'loading', mode: null, user: null, error: null })
    renderGate()
    expect(screen.getByText('正在检查登录状态…')).toBeTruthy()
    expect(screen.queryByText('受保护内容')).toBeNull()
  })

  it('anonymous → 跳转 /login', () => {
    useAuthStore.setState({ status: 'anonymous', mode: null, user: null, error: null })
    renderGate()
    expect(screen.getByText('登录页')).toBeTruthy()
    expect(screen.queryByText('受保护内容')).toBeNull()
  })

  it('authenticated → 放行子路由', () => {
    useAuthStore.setState({
      status: 'authenticated',
      mode: 'password',
      user: { id: 'u1', name: '测试用户', username: 'demo-user' },
      error: null,
    })
    renderGate()
    expect(screen.getByText('受保护内容')).toBeTruthy()
  })

  it('error → 明确展示检查失败 + 重试入口（不静默当未登录）', () => {
    useAuthStore.setState({ status: 'error', mode: null, user: null, error: '网络连接失败' })
    renderGate()
    expect(screen.getByText('暂时无法确认登录状态')).toBeTruthy()
    expect(screen.getByText('网络连接失败')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })
})
