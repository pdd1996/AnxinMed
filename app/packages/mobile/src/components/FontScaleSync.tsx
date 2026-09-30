import { useEffect } from "react";
import { rem } from "nativewind";
import { useFontScale } from "@/stores/fontScale";

/**
 * 两档根字号（dp）：与 global.css 的 `:root{font-size}` 同源，normal=17 / large=20（M1-T8 老年向令牌）。
 * metro 侧必须 `inlineRem:false`（否则 rem 在编译期烤死，这里 set 了也不生效）。
 */
export const FONT_ROOT_DP = { normal: 17, large: 20 } as const;

/**
 * RN 版 FontScaleSync：web 靠 `document.documentElement.dataset.scale` 驱动 rem
 * （web/src/components/layout/FontScaleSync.tsx:11），RN 无 DOM，改成把档位写进 NativeWind 的
 * rem 可观察量。挂载即应用（含 AsyncStorage persist 水合后的值），切档时全 app 立即重解析。
 * 返回 null，不渲染 UI。
 */
export function FontScaleSync() {
  const scale = useFontScale((s) => s.scale);

  useEffect(() => {
    rem.set(FONT_ROOT_DP[scale]);
  }, [scale]);

  return null;
}
