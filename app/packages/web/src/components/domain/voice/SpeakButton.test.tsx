/**
 * M3-T4 · SpeakButton 组件断言（spec §T4.2 咨询回答可播放 + §T4.3 降级）。
 *
 * 注入 mock speechSynthesis/SpeechSynthesisUtterance 走真实 speak() 路径；
 * jsdom 默认无 speechSynthesis → 覆盖降级分支。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SpeakButton } from './SpeakButton'

interface MockUtterance {
  text: string
  lang: string
  rate: number
  onend: (() => void) | null
}

function stubSynthesis() {
  const cancel = vi.fn()
  const speakFn = vi.fn()
  const utterances: MockUtterance[] = []
  class Utterance {
    lang = ''
    rate = 1
    pitch = 1
    volume = 1
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    constructor(public text: string) {
      utterances.push(this as unknown as MockUtterance)
    }
  }
  vi.stubGlobal('speechSynthesis', { cancel, speak: speakFn })
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  return { cancel, speakFn, utterances }
}

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('SpeakButton · 降级（spec §T4.3）', () => {
  it('speechSynthesis 不可用 → 按钮置灰 + title 文案说明', () => {
    render(<SpeakButton text="该药用于缓解干眼症状" />)
    const btn = screen.getByRole('button', { name: '播放回答' })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(btn.getAttribute('title')).toMatch(/不支持语音播报/)
  })

  it('文本为空 → 即使支持也置灰（无内容可播）', () => {
    stubSynthesis()
    render(<SpeakButton text="   " />)
    const btn = screen.getByRole('button', { name: '播放回答' })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('SpeakButton · 播放/停止（spec §T4.2）', () => {
  it('点击播放 → 中文 speechSynthesis 播报（lang=zh-CN）；再点停止', () => {
    const { cancel, speakFn, utterances } = stubSynthesis()
    render(<SpeakButton text="该药用于缓解干眼症状" />)
    const btn = screen.getByRole('button', { name: '播放回答' })

    fireEvent.click(btn)
    expect(speakFn).toHaveBeenCalledTimes(1)
    expect(utterances[0]?.text).toBe('该药用于缓解干眼症状')
    expect(utterances[0]?.lang).toBe('zh-CN')
    // 播放态：文案与 aria-label 切换为停止
    expect(screen.getByRole('button', { name: '停止播放' })).toBeTruthy()
    expect(screen.getByText('停止')).toBeTruthy()

    // 再点 → 停止（cancel 再次被调用）
    fireEvent.click(screen.getByRole('button', { name: '停止播放' }))
    expect(cancel.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: '播放回答' })).toBeTruthy()
  })

  it('播报自然结束（onend）→ 自动复位为播放态', () => {
    const { utterances } = stubSynthesis()
    render(<SpeakButton text="回答" />)
    fireEvent.click(screen.getByRole('button', { name: '播放回答' }))
    expect(screen.getByRole('button', { name: '停止播放' })).toBeTruthy()
    act(() => utterances[0]?.onend?.())
    expect(screen.getByRole('button', { name: '播放回答' })).toBeTruthy()
  })

  it('自定义 label 作为无障碍名', () => {
    stubSynthesis()
    render(<SpeakButton text="回答" label="朗读这条回答" />)
    expect(screen.getByRole('button', { name: '朗读这条回答' })).toBeTruthy()
  })
})
