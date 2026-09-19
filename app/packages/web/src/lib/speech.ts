/**
 * 语音合成（TTS）纯助手（M3-T4 · spec §T4.2）——能力探测 / 中文播报。
 *
 * - 纯函数封装浏览器 speechSynthesis，可独立单测；
 * - 降级优先（spec §T4.3）：speechSynthesis 不可用时安全返回，主流程零阻塞；
 * - 消费方：SpeakButton（回答播报）、ReminderModal（提醒播报）。
 * - 按键式语音输入（SpeechRecognition）已按产品决定整体移除（2026-09-20）。
 */

/** 语音合成（TTS）是否可用。 */
export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

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
  /** 播报结束回调（正常结束或被 cancel 打断都会触发 onend）。 */
  onEnd?: () => void
}

/**
 * 中文语音播报（speechSynthesis）。不支持时静默返回（降级：播报只是增强，非主流程）。
 * 每次播报前先 cancel，避免叠音（沿用 ReminderModal 行为）。
 */
export function speak(text: string, options: SpeakOptions = {}): void {
  if (!isSpeechSynthesisSupported()) return
  const trimmed = text.trim()
  if (!trimmed) return
  const { lang = 'zh-CN', rate = 0.92, pitch = 1, volume = 1, onStart, onEnd } = options
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(trimmed)
  utterance.lang = lang
  utterance.rate = rate
  utterance.pitch = pitch
  utterance.volume = volume
  if (onStart) utterance.onstart = onStart
  if (onEnd) utterance.onend = onEnd
  window.speechSynthesis.speak(utterance)
}

/** 停止当前播报（不支持时安全返回）。 */
export function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return
  window.speechSynthesis.cancel()
}
