/**
 * 语音合成（TTS）的 web 实现（M3-T4 起；M5-T2 接缝 #7：接口与降级语义在 @anxin/core，本端只做实现）。
 *
 * - 纯浏览器 speechSynthesis 封装，实现 core 的 SpeechAdapter 接口；
 * - 降级优先（spec §T4.3）：speechSynthesis 不可用时安全返回，主流程零阻塞；
 * - 装配点在 lib/wiring.ts（setSpeechAdapter），消费方（SpeakButton / ReminderModal）经 core 门面取用。
 * - 按键式语音输入（SpeechRecognition）已按产品决定整体移除（2026-09-20）。
 */
import { DEFAULT_SPEAK_OPTIONS, type SpeakOptions, type SpeechAdapter } from '@anxin/core'

/** 语音合成（TTS）是否可用。 */
function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * 中文语音播报（speechSynthesis）。不支持时静默返回（降级：播报只是增强，非主流程）。
 * 每次播报前先 cancel，避免叠音（沿用 ReminderModal 行为）。
 */
function speak(text: string, options: SpeakOptions = {}): void {
  if (!isSpeechSynthesisSupported()) return
  const trimmed = text.trim()
  if (!trimmed) return
  const {
    lang = DEFAULT_SPEAK_OPTIONS.lang,
    rate = DEFAULT_SPEAK_OPTIONS.rate,
    pitch = DEFAULT_SPEAK_OPTIONS.pitch,
    volume = DEFAULT_SPEAK_OPTIONS.volume,
    onStart,
    onEnd,
  } = options
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(trimmed)
  utterance.lang = lang
  utterance.rate = rate
  utterance.pitch = pitch
  utterance.volume = volume
  if (onStart) utterance.onstart = onStart
  if (onEnd) {
    utterance.onend = onEnd
    // 合成失败（如浏览器缺中文语音包）只发 error 不发 end：错误也走同一复位回调，
    // 避免消费方播放态卡死（按钮永远显示「停止」）。
    utterance.onerror = onEnd
  }
  window.speechSynthesis.speak(utterance)
}

/** 停止当前播报（不支持时安全返回）。 */
function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return
  window.speechSynthesis.cancel()
}

/** 本端 TTS 适配器（web=speechSynthesis；mobile 侧为 expo-speech，T7）。 */
export const webSpeechAdapter: SpeechAdapter = {
  isSupported: isSpeechSynthesisSupported,
  speak,
  stopSpeaking,
}
