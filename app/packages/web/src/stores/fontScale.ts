import { createJSONStorage } from 'zustand/middleware'
import { createFontScaleStore, type FontScaleState } from '@anxin/core'

/**
 * 字号档 store 的 web 装配（M5-T2 接缝 #2）：持久化后端 = localStorage（刷新后保持）。
 * store 本体与 persist key 在 @anxin/core，这里只注入本端存储；mobile 侧注入 AsyncStorage。
 */
export const useFontScale = createFontScaleStore(createJSONStorage<FontScaleState>(() => localStorage))

/** 字号档位类型（真相在 core，此处随装配一并转口，@/stores/fontScale 用法不变）。 */
export type { FontScale } from '@anxin/core'
