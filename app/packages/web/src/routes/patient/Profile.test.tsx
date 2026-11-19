/**
 * Profile 页组件断言：健康信息已改为独立一级页后的入口列表 + 头部读取登录态。
 * demo 模式断言四条入口的文案与 href（/account 与 /health-info、/records 同级），
 * 并确认字段卡不再内嵌在本页、「绑定医生」「登录密码」入口不出现（demo 没有真实账号语义）；
 * password 模式多两条入口：「绑定医生」（/my-doctor，specs/25 从设置页迁出）与
 * 「登录密码」（/password，2026-11-19 从设置页「账号与安全」上移）。
 * 头部姓名来自 store（G8 增补前是写死的「演示用户 · 张某某」）。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
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
  it('demo 模式：个人资料 / 健康信息 / 服药记录 / 设置四条入口齐备且 href 正确', () => {
    renderProfile()
    expect(screen.getByRole('link', { name: /个人资料/ }).getAttribute('href')).toBe('/account')
    expect(screen.getByRole('link', { name: /健康信息/ }).getAttribute('href')).toBe('/health-info')
    expect(screen.getByRole('link', { name: /服药记录/ }).getAttribute('href')).toBe('/records')
    expect(screen.getByRole('link', { name: /设置/ }).getAttribute('href')).toBe('/settings')
  })

  it('demo 模式不出现「绑定医生」入口（没有真实医患绑定语义）', () => {
    renderProfile()
    expect(screen.queryByRole('link', { name: /绑定医生/ })).toBeNull()
  })

  it('demo 模式不出现「登录密码」入口（demo 没有真实账号，改密无意义）', () => {
    renderProfile()
    expect(screen.queryByRole('link', { name: /登录密码/ })).toBeNull()
  })

  it('健康信息字段卡不再内嵌在本页（已迁到 /health-info 一级页）', () => {
    renderProfile()
    expect(screen.queryByText('过敏史')).toBeNull()
    expect(screen.queryByText('待补充')).toBeNull()
    expect(screen.queryByText('健康信息读取失败')).toBeNull()
  })
})

describe('Profile 页 · 绑定医生入口（specs/25 · 仅 password 模式）', () => {
  it('password 模式出现「绑定医生」链接且 href 为 /my-doctor', () => {
    useAuthStore.setState({ mode: 'password' })
    renderProfile()
    const link = screen.getByRole('link', { name: /绑定医生/ })
    expect(link.getAttribute('href')).toBe('/my-doctor')
  })

  it('归在「其他」组、排在设置上面，不在「健康」组（2026-11-19 用户要求调整分组与顺序）', () => {
    useAuthStore.setState({ mode: 'password' })
    renderProfile()
    const otherGroup = screen.getByRole('navigation', { name: '其他' })
    expect(within(otherGroup).getByRole('link', { name: /绑定医生/ })).toBeTruthy()
    // 「设置」固定排在组内最下面：组内链接顺序 = [绑定医生, 设置]
    const otherLabels = within(otherGroup)
      .getAllByRole('link')
      .map((a) => a.textContent ?? '')
    expect(otherLabels.at(-1)).toContain('设置')
    expect(otherLabels.findIndex((t) => t.includes('绑定医生'))).toBeLessThan(otherLabels.length - 1)
    expect(within(screen.getByRole('navigation', { name: '健康' })).queryByRole('link', { name: /绑定医生/ })).toBeNull()
  })
})

describe('Profile 页 · 登录密码入口（2026-11-19 从设置页上移 · 仅 password 模式）', () => {
  it('password 模式出现「登录密码」链接且 href 为 /password', () => {
    useAuthStore.setState({ mode: 'password' })
    renderProfile()
    const link = screen.getByRole('link', { name: /登录密码/ })
    expect(link.getAttribute('href')).toBe('/password')
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
