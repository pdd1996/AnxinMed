import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { FontScaleSync } from './FontScaleSync'
import { useFontScale } from '@/stores/fontScale'

describe('FontScaleSync（字号档 → <html data-scale>）', () => {
  afterEach(() => {
    cleanup()
    useFontScale.setState({ scale: 'normal' })
    delete document.documentElement.dataset.scale
  })

  it('挂载即把当前档写入 <html data-scale>', () => {
    useFontScale.setState({ scale: 'normal' })
    render(<FontScaleSync />)
    expect(document.documentElement.dataset.scale).toBe('normal')
  })

  it('档位切换后同步更新 <html data-scale> 为 large', () => {
    render(<FontScaleSync />)
    act(() => useFontScale.getState().setScale('large'))
    expect(document.documentElement.dataset.scale).toBe('large')
  })
})
