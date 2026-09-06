/**
 * M3-T4 · useSpeechRecognition hook 单测（spec §T4.1 / §T4.3）。
 *
 * 用可控 mock SpeechRecognition 捕获实例，直接触发 onresult/onerror/onend 验证状态机；
 * jsdom 默认无 SpeechRecognition → 覆盖降级分支。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSpeechRecognition } from './useSpeechRecognition'
import type {
  SpeechRecognitionAlternativeLike,
  SpeechRecognitionCtor,
  SpeechRecognitionErrorEventLike,
  SpeechRecognitionEventLike,
  SpeechRecognitionResultLike,
  SpeechRecognitionResultListLike,
} from '@/lib/speech'

/** mock 实例的可观测视图（onX 回调 + vi.fn 方法）。 */
type MockRec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
}

/** 注入 mock SpeechRecognition，返回已创建实例数组。 */
function installMock(): { created: MockRec[] } {
  const created: MockRec[] = []
  class MockRecognition {
    lang = ''
    continuous = false
    interimResults = false
    maxAlternatives = 1
    onstart: (() => void) | null = null
    onresult: ((e: SpeechRecognitionEventLike) => void) | null = null
    onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null = null
    onend: (() => void) | null = null
    start = vi.fn()
    stop = vi.fn()
    abort = vi.fn()
    constructor() {
      created.push(this as unknown as MockRec)
    }
  }
  vi.stubGlobal('SpeechRecognition', MockRecognition as unknown as SpeechRecognitionCtor)
  return { created }
}

const alt = (transcript: string, confidence = 0.9): SpeechRecognitionAlternativeLike => ({ transcript, confidence })
const res = (isFinal: boolean, transcript: string): SpeechRecognitionResultLike =>
  Object.assign([alt(transcript)], { isFinal }) as SpeechRecognitionResultLike
const resultEvent = (resultIndex: number, results: SpeechRecognitionResultLike[]): SpeechRecognitionEventLike => ({
  resultIndex,
  results: results as unknown as SpeechRecognitionResultListLike,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSpeechRecognition · 降级（spec §T4.3）', () => {
  it('不支持时 supported=false，start() 为 no-op（不抛错、不置 listening）', () => {
    const { result } = renderHook(() => useSpeechRecognition())
    expect(result.current.supported).toBe(false)
    expect(() => act(() => result.current.start())).not.toThrow()
    expect(result.current.listening).toBe(false)
    expect(result.current.transcript).toBe('')
  })
})

describe('useSpeechRecognition · 生命周期', () => {
  it('支持时 start() 创建实例、透传默认 lang=zh-CN、置 listening', () => {
    const { created } = installMock()
    const { result } = renderHook(() => useSpeechRecognition())
    expect(result.current.supported).toBe(true)
    act(() => result.current.start())
    expect(created).toHaveLength(1)
    expect(created[0]?.lang).toBe('zh-CN')
    expect(created[0]?.continuous).toBe(false)
    expect(created[0]?.interimResults).toBe(true)
    expect(created[0]?.start).toHaveBeenCalled()
    expect(result.current.listening).toBe(true)
  })

  it('自定义 lang/continuous/interimResults 透传', () => {
    const { created } = installMock()
    const { result } = renderHook(() =>
      useSpeechRecognition({ lang: 'en-US', continuous: true, interimResults: false }),
    )
    act(() => result.current.start())
    expect(created[0]?.lang).toBe('en-US')
    expect(created[0]?.continuous).toBe(true)
    expect(created[0]?.interimResults).toBe(false)
  })

  it('interim 结果 → 进 interim，不进 transcript', () => {
    const { created } = installMock()
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => created[0]?.onresult?.(resultEvent(0, [res(false, '玻璃')])))
    expect(result.current.interim).toBe('玻璃')
    expect(result.current.transcript).toBe('')
  })

  it('final 结果累积到 transcript（resultIndex 指向新起点）', () => {
    const { created } = installMock()
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    const r0 = res(true, '玻璃酸钠')
    const r1 = res(true, '滴眼液')
    act(() => created[0]?.onresult?.(resultEvent(0, [r0])))
    expect(result.current.transcript).toBe('玻璃酸钠')
    // 第二次事件携带累积结果，resultIndex=1 只处理新增
    act(() => created[0]?.onresult?.(resultEvent(1, [r0, r1])))
    expect(result.current.transcript).toBe('玻璃酸钠滴眼液')
  })

  it('onerror not-allowed → 可见错误提示 + listening=false', () => {
    const { created } = installMock()
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => created[0]?.onerror?.({ error: 'not-allowed' }))
    expect(result.current.error).toMatch(/麦克风权限/)
    expect(result.current.listening).toBe(false)
  })

  it('onerror aborted → error 保持 null（良性中断，不打扰用户）', () => {
    const { created } = installMock()
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => created[0]?.onerror?.({ error: 'aborted' }))
    expect(result.current.error).toBeNull()
  })

  it('onend → listening=false、interim 清空、transcript 保留（供转写确认）', () => {
    const { created } = installMock()
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => created[0]?.onresult?.(resultEvent(0, [res(false, '玻璃')])))
    act(() => created[0]?.onresult?.(resultEvent(0, [res(true, '玻璃酸钠')])))
    act(() => created[0]?.onend?.())
    expect(result.current.listening).toBe(false)
    expect(result.current.interim).toBe('')
    expect(result.current.transcript).toBe('玻璃酸钠')
  })

  it('stop() → 调用 rec.stop，listening=false，保留 transcript', () => {
    const { created } = installMock()
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => created[0]?.onresult?.(resultEvent(0, [res(true, '玻璃酸钠')])))
    act(() => result.current.stop())
    expect(created[0]?.stop).toHaveBeenCalled()
    expect(result.current.listening).toBe(false)
    expect(result.current.transcript).toBe('玻璃酸钠')
  })

  it('cancel() → 调用 rec.abort，清空 transcript/interim/error', () => {
    const { created } = installMock()
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => created[0]?.onresult?.(resultEvent(0, [res(true, '玻璃酸钠')])))
    act(() => result.current.cancel())
    expect(created[0]?.abort).toHaveBeenCalled()
    expect(result.current.transcript).toBe('')
    expect(result.current.listening).toBe(false)
  })

  it('reset() → 清空 transcript，但不 abort 实例', () => {
    const { created } = installMock()
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => created[0]?.onresult?.(resultEvent(0, [res(true, '玻璃酸钠')])))
    act(() => result.current.reset())
    expect(result.current.transcript).toBe('')
    expect(created[0]?.abort).not.toHaveBeenCalled()
  })

  it('重复 start() → 中断上一实例后再新建（不叠加）', () => {
    const { created } = installMock()
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    act(() => result.current.start())
    expect(created).toHaveLength(2)
    expect(created[0]?.abort).toHaveBeenCalled()
  })

  it('卸载 → abort 存活实例并摘除回调（清理，防幽灵识别）', () => {
    const { created } = installMock()
    const { result, unmount } = renderHook(() => useSpeechRecognition())
    act(() => result.current.start())
    unmount()
    expect(created[0]?.abort).toHaveBeenCalled()
    expect(created[0]?.onresult).toBeNull()
  })
})
