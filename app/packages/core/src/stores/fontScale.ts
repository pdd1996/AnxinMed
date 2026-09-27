import { create, type StateCreator } from 'zustand'
import { persist, type PersistStorage } from 'zustand/middleware'

/** 字号两档：normal（根 17px）/ large（根 20px）。由 <html data-scale> 驱动 rem 令牌。 */
export type FontScale = 'normal' | 'large'

export interface FontScaleState {
  scale: FontScale
  setScale: (scale: FontScale) => void
  toggle: () => void
}

/** persist 存储键（沿用 web 现状，刷新后保持）。 */
export const FONT_SCALE_PERSIST_KEY = 'anxin-font-scale'

/**
 * 字号档 store 工厂（老年向，技术方案 §8）——M5-T2 接缝 #2：core 无 DOM，持久化后端由本端注入
 * （web=createJSONStorage(localStorage)，mobile=AsyncStorage）；不传则纯内存（不接 persist，也不警告）。
 * 实际写入 <html data-scale> 的副作用在 FontScaleSync 组件里（便于测试与 SSR 安全）。
 */
export function createFontScaleStore(storage?: PersistStorage<FontScaleState>) {
  const init: StateCreator<FontScaleState> = (set, get) => ({
    scale: 'normal',
    setScale: (scale) => set({ scale }),
    toggle: () => set({ scale: get().scale === 'normal' ? 'large' : 'normal' }),
  })
  return storage
    ? create<FontScaleState>()(persist(init, { name: FONT_SCALE_PERSIST_KEY, storage }))
    : create<FontScaleState>()(init)
}
