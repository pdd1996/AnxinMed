/**
 * 确认式建议卡组件测试（M4-T6 · specs/04-T6 完成标准：卡片 L0 差异告知 UI 断言）。
 *
 * 只 mock 传输层（acceptSuggestion/dismissSuggestion），组件/路由全走真代码：
 * - add_drug 卡：透明告知双路径差异（拍照保留完整咨询 / 手动仅 L0）+ 零写入承诺文案；
 * - accept 按钮调 acceptSuggestion(id, path)；忽略调 dismissSuggestion(id)；
 * - note_symptom 卡：引导去健康信息页，无 accept 动作。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SuggestionCard } from './SuggestionCard'
import type { ConsultSuggestion } from '@anxin/shared'

const mocks = vi.hoisted(() => ({
  acceptSuggestion: vi.fn(),
  dismissSuggestion: vi.fn(),
}))
vi.mock('@/api/client', () => mocks)

function renderCard(suggestion: ConsultSuggestion) {
  return render(
    <MemoryRouter>
      <SuggestionCard suggestion={suggestion} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.acceptSuggestion.mockReset()
  mocks.dismissSuggestion.mockReset()
  mocks.acceptSuggestion.mockResolvedValue({ path: 'ocr', target: '/intake/drug', drugName: '布洛芬片' })
  mocks.dismissSuggestion.mockResolvedValue({ dismissed: true })
})
afterEach(cleanup)

describe('SuggestionCard · add_drug（确认式双路径）', () => {
  const ADD: ConsultSuggestion = { type: 'add_drug', id: 'csug-1', drugName: '布洛芬片' }

  it('渲染加药询问 + L0 门禁差异透明告知（拍照保留完整咨询 / 手动仅说明书资料）', () => {
    renderCard(ADD)
    expect(screen.getByText(/要把「布洛芬片」加入药箱吗/)).toBeTruthy()
    // 透明告知（裁决 #4/#7）：手动建档仅可查说明书资料（L0）；拍照建档保留完整咨询
    expect(screen.getByText(/拍照建档保留完整/)).toBeTruthy()
    expect(screen.getByText(/仅可查药品说明书资料（L0）/)).toBeTruthy()
    // 零写入承诺：建档信息需经用户确认才写入
    expect(screen.getByText(/需经你确认后才会写入药箱/)).toBeTruthy()
  })

  it('拍照建档 → acceptSuggestion(id, "ocr")', async () => {
    renderCard(ADD)
    fireEvent.click(screen.getByRole('button', { name: /拍照建档/ }))
    await waitFor(() => {
      expect(mocks.acceptSuggestion).toHaveBeenCalledWith('csug-1', 'ocr')
    })
  })

  it('手动建档 → acceptSuggestion(id, "manual")', async () => {
    renderCard(ADD)
    fireEvent.click(screen.getByRole('button', { name: /手动建档/ }))
    await waitFor(() => {
      expect(mocks.acceptSuggestion).toHaveBeenCalledWith('csug-1', 'manual')
    })
  })

  it('忽略 → dismissSuggestion(id)，卡片消失', async () => {
    renderCard(ADD)
    fireEvent.click(screen.getByRole('button', { name: '忽略' }))
    await waitFor(() => {
      expect(mocks.dismissSuggestion).toHaveBeenCalledWith('csug-1')
      expect(screen.queryByText(/要把「布洛芬片」加入药箱吗/)).toBeNull()
    })
  })
})

describe('SuggestionCard · note_symptom（纯引导，裁决 #4）', () => {
  it('引导去健康信息页（/profile 链接），无 accept；忽略纯前端收起不调接口', async () => {
    renderCard({ type: 'note_symptom' })
    expect(screen.getByText(/记到健康信息里吧/)).toBeTruthy()
    const link = screen.getByRole('link', { name: '去健康信息' })
    expect(link.getAttribute('href')).toBe('/profile')
    // 不落库：不出现建档双路径按钮
    expect(screen.queryByRole('button', { name: /拍照建档/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '忽略' }))
    await waitFor(() => {
      expect(screen.queryByText(/记到健康信息里吧/)).toBeNull()
    })
    expect(mocks.dismissSuggestion).not.toHaveBeenCalled() // 纯引导卡无 id，不调 dismiss
  })
})
