/**
 * M5-T2 · TTS 接缝单测：core 只有接口与注入点，不含任何平台 API。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  DEFAULT_SPEAK_OPTIONS,
  isSpeechSupported,
  noopSpeechAdapter,
  setSpeechAdapter,
  speak,
  stopSpeaking,
} from './speech'

afterEach(() => setSpeechAdapter(noopSpeechAdapter))

describe('speech · 未装配（默认 no-op）即降级', () => {
  it('isSpeechSupported=false，speak/stopSpeaking 不抛错', () => {
    expect(isSpeechSupported()).toBe(false)
    expect(() => speak('该药用于缓解干眼症状')).not.toThrow()
    expect(() => stopSpeaking()).not.toThrow()
  })
})

describe('speech · 装配后门面转达到本端实现', () => {
  it('speak/stopSpeaking/isSupported 全部走注入的适配器', () => {
    const impl = { isSupported: vi.fn(() => true), speak: vi.fn(), stopSpeaking: vi.fn() }
    setSpeechAdapter(impl)
    expect(isSpeechSupported()).toBe(true)
    speak('回答', { rate: 1.1 })
    expect(impl.speak).toHaveBeenCalledWith('回答', { rate: 1.1 })
    stopSpeaking()
    expect(impl.stopSpeaking).toHaveBeenCalledTimes(1)
  })

  it('默认播报参数双端共用（中文 + 偏慢语速，老年向实测值）', () => {
    expect(DEFAULT_SPEAK_OPTIONS).toMatchObject({ lang: 'zh-CN', rate: 0.92 })
  })
})
