import {
  resetAuthState,
  setApiNotifier,
  setAuthTokenStorage,
  setSpeechAdapter,
  setUnauthorizedHandler,
} from '@anxin/core'
import { toast } from 'sonner'
import { webSpeechAdapter } from './speech'

/**
 * web 侧平台装配（M5-T2；G7 增补登录态接缝）：把本端实现注入 core：
 *
 *   · ApiNotifier —— API 层错误提示走 sonner（core 禁 import sonner，见根 eslint 的 core 段）；
 *   · SpeechAdapter —— TTS 走浏览器 speechSynthesis（mobile 侧换 expo-speech，T7）；
 *   · AuthTokenStorage —— 登录 token 存 localStorage（刷新后保持；mobile 换 AsyncStorage）；
 *   · UnauthorizedHandler —— 401 清登录态，路由守卫看到 anonymous 自动跳 /login。
 *
 * 字号档 store 的存储注入在 stores/fontScale.ts，图片像素统计在 lib/imageStats.ts（同为平台触点）。
 * 应用入口 main.tsx 调一次；测试经 src/test/setup.ts 同样装配，保证跑的是同一条路径。
 */
export function wireWebPlatform(): void {
  setApiNotifier({ onError: (message) => toast.error(message) })
  setSpeechAdapter(webSpeechAdapter)
  setAuthTokenStorage({
    load: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(AUTH_TOKEN_KEY)),
    save: (token) => {
      if (typeof window !== 'undefined') window.localStorage.setItem(AUTH_TOKEN_KEY, token)
    },
    clear: () => {
      if (typeof window !== 'undefined') window.localStorage.removeItem(AUTH_TOKEN_KEY)
    },
  })
  setUnauthorizedHandler(() => {
    void resetAuthState()
  })
}

/** 登录 token 的 localStorage 键（与 mobile 的 AsyncStorage 同键名，便于运维排查）。 */
export const AUTH_TOKEN_KEY = 'anxin-auth-token'
