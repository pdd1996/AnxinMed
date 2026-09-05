import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 字号两档：normal（根 17px）/ large（根 20px）。由 <html data-scale> 驱动 rem 令牌。 */
export type FontScale = 'normal' | 'large'

interface FontScaleState {
  scale: FontScale
  setScale: (scale: FontScale) => void
  toggle: () => void
}

/**
 * 字号档 store（老年向，技术方案 §8）。持久化到 localStorage，刷新后保持。
 * 实际写入 <html data-scale> 的副作用在 FontScaleSync 组件里（便于测试与 SSR 安全）。
 */
export const useFontScale = create<FontScaleState>()(
  persist(
    (set, get) => ({
      scale: 'normal',
      setScale: (scale) => set({ scale }),
      toggle: () => set({ scale: get().scale === 'normal' ? 'large' : 'normal' }),
    }),
    { name: 'anxin-font-scale' },
  ),
)
