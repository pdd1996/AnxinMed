import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { BottomNav } from './BottomNav'

describe('BottomNav（患者端底部导航）', () => {
  afterEach(cleanup)

  it('渲染 5 个导航项，且图标 + 文字并用', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <BottomNav />
      </MemoryRouter>,
    )
    for (const label of ['用药', '药箱', '录入', 'AI 咨询', '我的']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    // 每项都是可导航链接
    expect(screen.getAllByRole('link')).toHaveLength(5)
  })
})
