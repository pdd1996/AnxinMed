/**
 * 语音合成（TTS）接缝（M3-T4 起，M5-T2 改为接口 + 注入）。
 *
 * core 只定**接口与降级语义**（spec §T4.3：播报是增强，非主流程，不可用时安全返回）：
 * - web 装配：window.speechSynthesis 实现（packages/web/src/lib/speech.ts）；
 * - mobile 装配：expo-speech 实现（T7）。
 * 消费方（SpeakButton / ReminderModal）一律经本模块的门面函数取用，不直接碰平台 API。
 * 按键式语音输入（SpeechRecognition）已按产品决定整体移除（2026-09-20）。
 */

/** 语音合成（TTS）参数。 */
export interface SpeakOptions {
  /** BCP-47 语言标签，默认中文（spec §T4.2 要求中文）。 */
  lang?: string
  /** 语速，默认 0.92（沿用 ReminderModal 实测值，偏慢利于老年用户）。 */
  rate?: number
  pitch?: number
  volume?: number
  /** 播报开始回调（用于 UI 播放态）。 */
  onStart?: () => void
  /** 播报结束回调（正常结束或被 cancel 打断都会触发 onEnd）。 */
  onEnd?: () => void
}

/** 双端共用的默认播报参数（各端实现以此为基线，避免话术/参数漂移）。 */
export const DEFAULT_SPEAK_OPTIONS = { lang: 'zh-CN', rate: 0.92, pitch: 1, volume: 1 } as const

/** 本端 TTS 能力接口。 */
export interface SpeechAdapter {
  isSupported(): boolean
  speak(text: string, options?: SpeakOptions): void
  stopSpeaking(): void
}

/** 未装配时的兜底：能力恒为否、播报为空操作（降级不报错）。 */
export const noopSpeechAdapter: SpeechAdapter = {
  isSupported: () => false,
  speak: () => {},
  stopSpeaking: () => {},
}

let speechAdapter: SpeechAdapter = noopSpeechAdapter

/** 装配本端 TTS 实现（web/mobile 在启动处调用）。 */
export function setSpeechAdapter(adapter: SpeechAdapter): void {
  speechAdapter = adapter
}

/** 当前装配的适配器（测试与高级用法）。 */
export function getSpeechAdapter(): SpeechAdapter {
  return speechAdapter
}

/** 语音合成（TTS）是否可用。 */
export function isSpeechSupported(): boolean {
  return speechAdapter.isSupported()
}

/** 中文语音播报；未装配或本端不支持时静默返回（降级）。 */
export function speak(text: string, options: SpeakOptions = {}): void {
  speechAdapter.speak(text, options)
}

/** 停止当前播报（不支持时安全返回）。 */
export function stopSpeaking(): void {
  speechAdapter.stopSpeaking()
}
