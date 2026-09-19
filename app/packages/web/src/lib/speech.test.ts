/**
 * M3-T4 · 语音合成（TTS）纯助手单测（spec §T4.2/T4.3：中文播报 + 不支持环境自动降级不报错）。
 *
 * jsdom 默认不实现 speechSynthesis，天然覆盖「降级」分支；「支持」分支用 vi.stubGlobal 注入 mock。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { isSpeechSynthesisSupported, speak, stopSpeaking } from './speech'

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

describe('speech · 能力探测（TTS）', () => {
  it('jsdom 默认无 speechSynthesis → supported=false（降级）', () => {
    expect(isSpeechSynthesisSupported()).toBe(false)
  })

  it('注入 speechSynthesis → supported=true', () => {
    stubSynthesis()
    expect(isSpeechSynthesisSupported()).toBe(true)
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
