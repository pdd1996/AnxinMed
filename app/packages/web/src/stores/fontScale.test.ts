import { describe, it, expect, beforeEach } from 'vitest'
import { useFontScale } from './fontScale'

describe('fontScale store（老年向字号两档）', () => {
  beforeEach(() => {
    useFontScale.setState({ scale: 'normal' })
    localStorage.removeItem('anxin-font-scale')
  })

  it('toggle 在 normal / large 之间来回切换', () => {
    expect(useFontScale.getState().scale).toBe('normal')
    useFontScale.getState().toggle()
    expect(useFontScale.getState().scale).toBe('large')
    useFontScale.getState().toggle()
    expect(useFontScale.getState().scale).toBe('normal')
  })

  it('setScale 直接设定档位', () => {
    useFontScale.getState().setScale('large')
    expect(useFontScale.getState().scale).toBe('large')
  })

  it('persist 把档位写入 localStorage（刷新后可保持）', () => {
    useFontScale.getState().setScale('large')
    const raw = localStorage.getItem('anxin-font-scale')
    expect(raw).toBeTruthy()
    expect(raw).toContain('large')
  })
})
