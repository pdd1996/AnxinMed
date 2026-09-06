/**
 * M3-T4 · speech 纯助手单测（spec §T4 完成标准：不支持环境自动降级不报错）。
 *
 * jsdom 默认不实现 Web Speech API（speechSynthesis / SpeechRecognition 均缺失），
 * 天然覆盖「降级」分支；「支持」分支用 vi.stubGlobal 注入 mock 构造函数。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getSpeechRecognitionCtor,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  mapSpeechRecognitionError,
  speak,
  stopSpeaking,
  type SpeechRecognitionCtor,
} from './speech'

/** 最小 SpeechRecognition mock 构造函数（结构对齐 SpeechRecognitionInstanceLike）。 */
function makeMockCtor(): SpeechRecognitionCtor {
  class MockRecognition {
    lang = ''
    continuous = false
    interimResults = false
    maxAlternatives = 1
    onstart: (() => void) | null = null
    onresult: ((event: { resultIndex: number }) => void) | null = null
    onerror: ((event: { error: string }) => void) | null = null
    onend: (() => void) | null = null
    start(): void {}
    stop(): void {}
    abort(): void {}
  }
  return MockRecognition as unknown as SpeechRecognitionCtor
}

/** 最小 speechSynthesis + SpeechSynthesisUtterance mock。 */
function stubSynthesis() {
  const cancel = vi.fn()
  const speakFn = vi.fn()
  const utterances: Array<{ text: string; lang: string; rate: number; onend: (() => void) | null }> = []
  class MockUtterance {
    lang = ''
    rate = 1
    pitch = 1
    volume = 1
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    constructor(public text: string) {
      utterances.push(this)
    }
  }
  vi.stubGlobal('speechSynthesis', { cancel, speak: speakFn })
  vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)
  return { cancel, speakFn, utterances }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('speech · 能力探测（STT）', () => {
  it('jsdom 默认无 SpeechRecognition → ctor=null，supported=false（降级）', () => {
    expect(getSpeechRecognitionCtor()).toBeNull()
    expect(isSpeechRecognitionSupported()).toBe(false)
  })

  it('注入标准名 window.SpeechRecognition → 探测到，supported=true', () => {
    const Ctor = makeMockCtor()
    vi.stubGlobal('SpeechRecognition', Ctor)
    expect(getSpeechRecognitionCtor()).toBe(Ctor)
    expect(isSpeechRecognitionSupported()).toBe(true)
  })

  it('仅有 webkit 前缀 → 回退命中 webkitSpeechRecognition', () => {
    const Ctor = makeMockCtor()
    vi.stubGlobal('webkitSpeechRecognition', Ctor)
    expect(getSpeechRecognitionCtor()).toBe(Ctor)
    expect(isSpeechRecognitionSupported()).toBe(true)
  })

  it('标准名与 webkit 同时存在 → 标准名优先', () => {
    const std = makeMockCtor()
    const webkit = makeMockCtor()
    vi.stubGlobal('SpeechRecognition', std)
    vi.stubGlobal('webkitSpeechRecognition', webkit)
    expect(getSpeechRecognitionCtor()).toBe(std)
  })
})

describe('speech · 能力探测（TTS）', () => {
  it('jsdom 默认无 speechSynthesis → supported=false（降级）', () => {
    expect(isSpeechSynthesisSupported()).toBe(false)
  })

  it('注入 speechSynthesis → supported=true', () => {
    stubSynthesis()
    expect(isSpeechSynthesisSupported()).toBe(true)
  })
})

describe('speech · 错误码映射（禁止静默吞错）', () => {
  it('aborted → null（用户主动取消，非错误，不展示）', () => {
    expect(mapSpeechRecognitionError('aborted')).toBeNull()
  })

  it('not-allowed / service-not-allowed → 麦克风权限提示', () => {
    expect(mapSpeechRecognitionError('not-allowed')).toMatch(/麦克风权限/)
    expect(mapSpeechRecognitionError('service-not-allowed')).toMatch(/麦克风权限/)
  })

  it('audio-capture → 未检测到麦克风', () => {
    expect(mapSpeechRecognitionError('audio-capture')).toMatch(/未检测到麦克风/)
  })

  it('no-speech → 没有听清', () => {
    expect(mapSpeechRecognitionError('no-speech')).toMatch(/没有听清/)
  })

  it('network → 联网异常', () => {
    expect(mapSpeechRecognitionError('network')).toMatch(/联网/)
  })

  it('未知码 → 兜底提示（不吞错）', () => {
    expect(mapSpeechRecognitionError('some-future-code')).toMatch(/语音识别失败/)
  })
})

describe('speech · speak（TTS，中文）', () => {
  it('不支持时 → 安全返回，不抛错', () => {
    expect(() => speak('你好')).not.toThrow()
  })

  it('支持时 → 先 cancel 再 speak，默认 lang=zh-CN、rate=0.92', () => {
    const { cancel, speakFn, utterances } = stubSynthesis()
    speak('该药用于缓解干眼症状')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(speakFn).toHaveBeenCalledTimes(1)
    expect(utterances[0]?.text).toBe('该药用于缓解干眼症状')
    expect(utterances[0]?.lang).toBe('zh-CN')
    expect(utterances[0]?.rate).toBe(0.92)
  })

  it('空/纯空白文本 → 不播报（避免空 utterance）', () => {
    const { speakFn } = stubSynthesis()
    speak('   ')
    expect(speakFn).not.toHaveBeenCalled()
  })

  it('自定义 rate/lang 透传；onEnd 挂到 utterance.onend', () => {
    const { utterances } = stubSynthesis()
    const onEnd = vi.fn()
    speak('测试', { rate: 1.1, lang: 'zh-TW', onEnd })
    expect(utterances[0]?.rate).toBe(1.1)
    expect(utterances[0]?.lang).toBe('zh-TW')
    expect(utterances[0]?.onend).toBe(onEnd)
  })
})

describe('speech · stopSpeaking', () => {
  it('不支持时 → 安全返回，不抛错', () => {
    expect(() => stopSpeaking()).not.toThrow()
  })

  it('支持时 → 调用 cancel', () => {
    const { cancel } = stubSynthesis()
    stopSpeaking()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
