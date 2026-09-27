/**
 * M5-T2 · 字号档 store 单测（自 web 随迁）。
 * 接缝变化：持久化后端不再假设 localStorage，而是注入的 storage（此处用内存实现，RN 侧同形换 AsyncStorage）。
 */
import { describe, it, expect } from 'vitest'
import { createJSONStorage, type StateStorage } from 'zustand/middleware'
import { FONT_SCALE_PERSIST_KEY, createFontScaleStore } from './fontScale'

/** 内存 StateStorage（平台无关的 storage 替身）。 */
function memoryStorage(): StateStorage & { dump(): Record<string, string> } {
  const map = new Map<string, string>()
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value)
    },
    removeItem: (name) => {
      map.delete(name)
    },
    dump: () => Object.fromEntries(map),
  }
}

describe('fontScale store（老年向字号两档）', () => {
  it('toggle 在 normal / large 之间来回切换', () => {
    const useFontScale = createFontScaleStore()
    expect(useFontScale.getState().scale).toBe('normal')
    useFontScale.getState().toggle()
    expect(useFontScale.getState().scale).toBe('large')
    useFontScale.getState().toggle()
    expect(useFontScale.getState().scale).toBe('normal')
  })

  it('setScale 直接设定档位', () => {
    const useFontScale = createFontScaleStore()
    useFontScale.getState().setScale('large')
    expect(useFontScale.getState().scale).toBe('large')
  })

  it('注入 storage 后 persist 把档位写入存储（键与 web 现状一致，刷新后可保持）', () => {
    const storage = memoryStorage()
    const useFontScale = createFontScaleStore(createJSONStorage(() => storage))
    useFontScale.getState().setScale('large')
    const raw = storage.dump()[FONT_SCALE_PERSIST_KEY]
    expect(raw).toBeTruthy()
    expect(raw).toContain('large')
  })

  it('同一存储再建新 store → 水合回上次的档位', async () => {
    const storage = memoryStorage()
    createFontScaleStore(createJSONStorage(() => storage)).getState().setScale('large')
    const reopened = createFontScaleStore(createJSONStorage(() => storage))
    await Promise.resolve()
    expect(reopened.getState().scale).toBe('large')
  })
})
