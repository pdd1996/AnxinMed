/**
 * Web Speech API 纯助手（M3-T4 · spec §T4）——能力探测 / 类型补充 / 错误映射 / 语音合成。
 *
 * 设计约束：
 * - 纯函数、无 React、无副作用（speak/stopSpeaking 除外，二者封装浏览器 TTS），可独立单测；
 * - 降级优先（spec §T4.3）：SpeechRecognition / speechSynthesis 不可用时全部安全返回，主流程零阻塞；
 * - TypeScript 的 lib.dom 未内置 SpeechRecognition（仅内置 SpeechSynthesis），此处补最小可用类型，
 *   统一用 `Like` 后缀避免与 DOM 全局类型冲突；禁用 any（走 unknown + 收窄）。
 */

/** 单条候选转写（Web Speech API SpeechRecognitionAlternative 的最小视图）。 */
export interface SpeechRecognitionAlternativeLike {
  readonly transcript: string
  readonly confidence: number
}

/** 一次识别结果（可含多条候选，[0] 为最优；isFinal 表示已定稿）。 */
export interface SpeechRecognitionResultLike extends ArrayLike<SpeechRecognitionAlternativeLike> {
  readonly isFinal: boolean
}

/** 结果列表（array-like）。 */
export type SpeechRecognitionResultListLike = ArrayLike<SpeechRecognitionResultLike>

/** onresult 事件。 */
export interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListLike
}

/** onerror 事件（error 为规范定义的字符串码）。 */
export interface SpeechRecognitionErrorEventLike {
  readonly error: string
  readonly message?: string
}

/** SpeechRecognition 实例的最小可用视图（只声明本项目用到的成员）。 */
export interface SpeechRecognitionInstanceLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}

/** SpeechRecognition 构造函数。 */
export type SpeechRecognitionCtor = new () => SpeechRecognitionInstanceLike

/** window 上可能挂载的语音识别构造函数（标准名 + webkit 前缀）。 */
type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

/**
 * 取当前浏览器的 SpeechRecognition 构造函数（标准名优先，回退 webkit 前缀）。
 * 不支持（Firefox/Safari 部分版本、SSR）时返回 null——降级判定的唯一真相源。
 */
export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as SpeechWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** 语音识别（STT）是否可用。 */
export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null
}

/** 语音合成（TTS）是否可用。 */
export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * 把 SpeechRecognition 的 error 码映射为用户可理解的中文提示（禁止静默吞错，AGENTS.md 硬边界）。
 * 返回 null 表示良性中断（用户主动取消），无需展示错误。
 */
export function mapSpeechRecognitionError(code: string): string | null {
  switch (code) {
    case 'aborted':
      // 用户主动停止/取消，非错误。
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风权限被拒绝。请在浏览器地址栏允许访问麦克风，或直接手动输入。'
    case 'audio-capture':
      return '未检测到麦克风。请连接麦克风后重试，或直接手动输入。'
    case 'no-speech':
      return '没有听清。请点击麦克风靠近一些再说，或直接手动输入。'
    case 'network':
      return '语音识别需要联网，当前网络异常。请检查网络，或直接手动输入。'
    case 'language-not-supported':
      return '当前浏览器不支持中文语音识别。请直接手动输入。'
    default:
      return '语音识别失败。请重试，或直接手动输入。'
  }
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
