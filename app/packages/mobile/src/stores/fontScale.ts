import AsyncStorage from "@react-native-async-storage/async-storage";
import { createJSONStorage } from "zustand/middleware";
import { createFontScaleStore, type FontScaleState } from "@anxin/core";

/**
 * 字号档 store 的 RN 装配（M5-T2 接缝 #2）：持久化后端 = AsyncStorage（杀进程重开保持）。
 * store 本体与 persist key（anxin-font-scale）在 @anxin/core，这里只注入本端存储；与 web 侧同构。
 */
export const useFontScale = createFontScaleStore(
  createJSONStorage<FontScaleState>(() => AsyncStorage)
);

/** 字号档位类型（真相在 core，此处随装配一并转口）。 */
export type { FontScale } from "@anxin/core";
