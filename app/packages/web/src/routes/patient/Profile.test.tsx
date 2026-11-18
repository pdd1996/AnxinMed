/**
 * Profile 页组件断言：健康信息已改为独立一级页后的入口列表 + 头部读取登录态。
 * 断言四条入口的文案与 href（/account 与 /health-info、/records 同级），
 * 并确认字段卡不再内嵌在本页；头部姓名来自 store（G8 增补前是写死的「演示用户 · 张某某」）。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@anxin/core'
import Profile from './Profile'

function renderProfile() {
  render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    mode: 'demo',
    user: { id: 'p-001', name: '张某某', username: null },
    error: null,
  })
})

afterEach(() => {
  cleanup()
  useAuthStore.setState({ status: 'idle', mode: null, user: null, error: null })
})

describe('Profile 页 · 入口列表', () => {
  it('个人资料 / 健康信息 / 服药记录 / 设置四条入口齐备且 href 正确', () => {
    renderProfile()
    expect(screen.getByRole('link', { name: /个人资料/ }).getAttribute('href')).toBe('/account')
    expect(screen.getByRole('link', { name: /健康信息/ }).getAttribute('href')).toBe('/health-info')
    expect(screen.getByRole('link', { name: /服药记录/ }).getAttribute('href')).toBe('/records')
    expect(screen.getByRole('link', { name: /设置/ }).getAttribute('href')).toBe('/settings')
  })

  it('健康信息字段卡不再内嵌在本页（已迁到 /health-info 一级页）', () => {
    renderProfile()
    expect(screen.queryByText('过敏史')).toBeNull()
    expect(screen.queryByText('待补充')).toBeNull()
    expect(screen.queryByText('健康信息读取失败')).toBeNull()
  })
})

describe('Profile 页 · 头部身份（G8 增补：读 store）', () => {
  it('demo 模式显示「演示用户 · 姓名」', () => {
    renderProfile()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('演示用户 · 张某某')
  })

  it('password 模式只显示姓名（真实账号不挂「演示用户」标记）', () => {
    useAuthStore.setState({ mode: 'password' })
    renderProfile()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('张某某')
  })

  it('姓名为空 → 兜底文案，不是空白头部', () => {
    useAuthStore.setState({ user: { id: 'u-1', name: null, username: 'u-1' } })
    renderProfile()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('演示用户 · 未设置姓名')
  })
})
