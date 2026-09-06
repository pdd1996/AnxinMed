/**
 * M3-T4 · VoiceDictationButton 组件断言（spec §T4 完成标准：不支持环境降级不报错 + 语音路径写入结果一致）。
 *
 * 注入 mock SpeechRecognition 驱动真实状态机：录音 → 定稿 → 转写确认 → 填入（onCommit）。
 * jsdom 默认无 SpeechRecognition → 覆盖降级分支。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { VoiceDictationButton } from './VoiceDictationButton'
import type {
  SpeechRecognitionAlternativeLike,
  SpeechRecognitionCtor,
  SpeechRecognitionEventLike,
  SpeechRecognitionResultLike,
  SpeechRecognitionResultListLike,
} from '@/lib/speech'

type MockRec = {
  lang: string
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
}

function installMock(): { created: MockRec[] } {
  const created: MockRec[] = []
  class MockRecognition {
    lang = ''
    continuous = false
    interimResults = false
    maxAlternatives = 1
    onstart: (() => void) | null = null
    onresult: ((e: SpeechRecognitionEventLike) => void) | null = null
    onerror: ((e: { error: string }) => void) | null = null
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

const alt = (transcript: string): SpeechRecognitionAlternativeLike => ({ transcript, confidence: 0.9 })
const res = (isFinal: boolean, transcript: string): SpeechRecognitionResultLike =>
  Object.assign([alt(transcript)], { isFinal }) as SpeechRecognitionResultLike
const resultEvent = (results: SpeechRecognitionResultLike[]): SpeechRecognitionEventLike => ({
  resultIndex: 0,
  results: results as unknown as SpeechRecognitionResultListLike,
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('VoiceDictationButton · 降级（spec §T4.3）', () => {
  it('不支持时 → 按钮置灰 + title 文案说明，点击不抛错', () => {
    const onCommit = vi.fn()
    render(<VoiceDictationButton onCommit={onCommit} label="语音输入药名" />)
    const btn = screen.getByRole('button', { name: '语音输入药名' })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(btn.getAttribute('title')).toMatch(/不支持语音输入/)
    expect(() => fireEvent.click(btn)).not.toThrow()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('自定义 unsupportedHint 透传到 title', () => {
    render(<VoiceDictationButton onCommit={vi.fn()} label="语音输入" unsupportedHint="请用 Chrome 浏览器" />)
    const btn = screen.getByRole('button', { name: '语音输入' })
    expect(btn.getAttribute('title')).toBe('请用 Chrome 浏览器')
  })
})

describe('VoiceDictationButton · 录音 → 转写确认 → 填入', () => {
  it('点击麦克风进入聆听；再点击停止；确认后 onCommit 收到定稿文本', () => {
    const { created } = installMock()
    const onCommit = vi.fn()
    render(<VoiceDictationButton onCommit={onCommit} label="语音输入药名" />)

    // 开始录音
    fireEvent.click(screen.getByRole('button', { name: '语音输入药名' }))
    expect(created).toHaveLength(1)
    // 聆听态：按钮 aria-label 切换为「停止录音」
    const stopBtn = screen.getByRole('button', { name: '停止录音' })
    expect(stopBtn).toBeTruthy()

    // 模拟识别到定稿结果
    act(() => created[0]?.onresult?.(resultEvent([res(true, '玻璃酸钠滴眼液')])))
    // 停止录音 → 进入转写确认
    fireEvent.click(stopBtn)

    // 确认浮层展示待填入文本
    expect(screen.getByText('识别到（请确认后填入）：')).toBeTruthy()
    expect(screen.getByText('「玻璃酸钠滴眼液」')).toBeTruthy()

    // 点击「填入」→ onCommit 收到 trim 后文本，浮层关闭
    fireEvent.click(screen.getByRole('button', { name: /填入/ }))
    expect(onCommit).toHaveBeenCalledWith('玻璃酸钠滴眼液')
    expect(screen.queryByText('识别到（请确认后填入）：')).toBeNull()
  })

  it('实时中间结果在聆听时回显，不提前 commit', () => {
    const { created } = installMock()
    const onCommit = vi.fn()
    render(<VoiceDictationButton onCommit={onCommit} label="语音输入" />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    act(() => created[0]?.onresult?.(resultEvent([res(false, '玻璃')])))
    expect(screen.getByText('「玻璃」')).toBeTruthy()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('「重说」→ 清空并重新开始录音（新实例）', () => {
    const { created } = installMock()
    const onCommit = vi.fn()
    render(<VoiceDictationButton onCommit={onCommit} label="语音输入" />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    act(() => created[0]?.onresult?.(resultEvent([res(true, '阿莫西林')])))
    fireEvent.click(screen.getByRole('button', { name: '停止录音' }))

    fireEvent.click(screen.getByRole('button', { name: '重说一次' }))
    expect(created).toHaveLength(2)
    expect(onCommit).not.toHaveBeenCalled()
    // 重新进入聆听态
    expect(screen.getByRole('button', { name: '停止录音' })).toBeTruthy()
  })

  it('「取消」→ 关闭浮层且不 commit', () => {
    const { created } = installMock()
    const onCommit = vi.fn()
    render(<VoiceDictationButton onCommit={onCommit} label="语音输入" />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    act(() => created[0]?.onresult?.(resultEvent([res(true, '阿莫西林')])))
    fireEvent.click(screen.getByRole('button', { name: '停止录音' }))

    fireEvent.click(screen.getByRole('button', { name: '取消语音输入' }))
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.queryByText('识别到（请确认后填入）：')).toBeNull()
  })

  it('识别出错 → 浮层展示中文错误提示（不静默吞错）', () => {
    const { created } = installMock()
    render(<VoiceDictationButton onCommit={vi.fn()} label="语音输入" />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    act(() => created[0]?.onerror?.({ error: 'not-allowed' }))
    expect(screen.getByText(/麦克风权限/)).toBeTruthy()
  })

  it('手动停止但无任何识别结果 → 显示「未识别到语音」可见提示（不静默关闭）', () => {
    installMock()
    const onCommit = vi.fn()
    render(<VoiceDictationButton onCommit={onCommit} label="语音输入" />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    // 不触发任何 onresult，直接手动停止
    fireEvent.click(screen.getByRole('button', { name: '停止录音' }))
    expect(screen.getByText(/未识别到语音/)).toBeTruthy()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('Esc → 取消录音并关闭浮层', () => {
    const { created } = installMock()
    const onCommit = vi.fn()
    render(<VoiceDictationButton onCommit={onCommit} label="语音输入" />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    act(() => created[0]?.onresult?.(resultEvent([res(true, '阿莫西林')])))
    fireEvent.click(screen.getByRole('button', { name: '停止录音' }))
    expect(screen.getByText('识别到（请确认后填入）：')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('识别到（请确认后填入）：')).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()
    expect(created[0]?.abort).toHaveBeenCalled()
  })
})
