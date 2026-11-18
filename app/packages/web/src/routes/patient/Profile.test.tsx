/**
 * Profile 页组件断言：健康信息已改为独立一级页后的入口列表。
 * 断言三条入口的文案与 href（/health-info 与 /records 同级），并确认字段卡不再内嵌在本页。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import Profile from './Profile'

function renderProfile() {
  render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('Profile 页 · 入口列表', () => {
  it('健康信息 / 服药记录 / 设置三条入口齐备且 href 正确', () => {
    renderProfile()
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
