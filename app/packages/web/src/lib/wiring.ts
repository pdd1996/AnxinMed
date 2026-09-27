import { setApiNotifier, setSpeechAdapter } from '@anxin/core'
import { toast } from 'sonner'
import { webSpeechAdapter } from './speech'

/**
 * web 侧平台装配（M5-T2）：把本端实现注入 core 的两个接缝，行为与抽包前逐字一致。
 *
 *   · ApiNotifier —— API 层错误提示走 sonner（core 禁 import sonner，见根 eslint 的 core 段）；
 *   · SpeechAdapter —— TTS 走浏览器 speechSynthesis（mobile 侧换 expo-speech，T7）。
 *
 * 字号档 store 的存储注入在 stores/fontScale.ts，图片像素统计在 lib/imageStats.ts（同为平台触点）。
 * 应用入口 main.tsx 调一次；测试经 src/test/setup.ts 同样装配，保证跑的是同一条路径。
 */
export function wireWebPlatform(): void {
  setApiNotifier({ onError: (message) => toast.error(message) })
  setSpeechAdapter(webSpeechAdapter)
}
