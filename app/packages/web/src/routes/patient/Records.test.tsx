/**
 * M3-T6 · Records 页组件断言：按日/周/月查询接线 + 列表 + 导出按钮态。
 * 只 mock 传输层 fetchRecords，页面/纯函数走真代码；CSV 文本正确性由 lib/records.test.ts 覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Records from './Records'
import { computeRange } from '@/lib/records'

const mocks = vi.hoisted(() => ({ fetchRecords: vi.fn() }))
vi.mock('@/api/client', () => mocks)

const ITEMS = [
  { id: 'r1', planId: 'p1', drugName: '玻璃酸钠滴眼液', scheduledDate: '2026-09-05', scheduledTime: '08:00', status: 'taken', actedAt: '2026-09-05T00:01:00.000Z' },
  { id: 'r2', planId: 'p2', drugName: '盐酸二甲双胍片', scheduledDate: '2026-09-01', scheduledTime: '20:00', status: 'skipped', actedAt: '2026-09-01T12:05:00.000Z' },
]

function renderRecords() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Records />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.fetchRecords.mockReset()
  mocks.fetchRecords.mockResolvedValue({
    range: computeRange('week'),
    summary: { total: 2, taken: 1, skipped: 1, later: 0 },
    items: ITEMS,
  })
})
afterEach(cleanup)

describe('Records 页 · 按日/周/月查询', () => {
  it('默认按周 → 用本周区间查询并渲染记录（药名）', async () => {
    renderRecords()
    const { from, to } = computeRange('week')
    await waitFor(() => expect(mocks.fetchRecords).toHaveBeenCalledWith(from, to))
    expect(await screen.findByText('玻璃酸钠滴眼液')).toBeTruthy()
    expect(screen.getByText('盐酸二甲双胍片')).toBeTruthy()
  })

  it('切到按日 → 用今天区间（from=to）重新查询', async () => {
    renderRecords()
    await screen.findByText('玻璃酸钠滴眼液')
    fireEvent.click(screen.getByRole('button', { name: '按日' }))
    const { from, to } = computeRange('day')
    await waitFor(() => expect(mocks.fetchRecords).toHaveBeenCalledWith(from, to))
    expect(from).toBe(to)
  })

  it('切到按月 → 用本月区间（1 号..今天）重新查询', async () => {
    renderRecords()
    await screen.findByText('玻璃酸钠滴眼液')
    fireEvent.click(screen.getByRole('button', { name: '按月' }))
    const { from, to } = computeRange('month')
    await waitFor(() => expect(mocks.fetchRecords).toHaveBeenCalledWith(from, to))
    expect(from.endsWith('-01')).toBe(true)
  })
})

describe('Records 页 · 导出与空态', () => {
  it('有记录 → 导出 CSV 按钮可用', async () => {
    renderRecords()
    await screen.findByText('玻璃酸钠滴眼液')
    const btn = screen.getByRole('button', { name: /导出 CSV/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('空区间 → 空态文案 + 导出按钮禁用', async () => {
    mocks.fetchRecords.mockResolvedValue({
      range: computeRange('week'),
      summary: { total: 0, taken: 0, skipped: 0, later: 0 },
      items: [],
    })
    renderRecords()
    expect(await screen.findByText(/该区间暂无服药记录/)).toBeTruthy()
    const btn = screen.getByRole('button', { name: /导出 CSV/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('留痕文案：明确「非系统医学验证」', async () => {
    renderRecords()
    await screen.findByText('玻璃酸钠滴眼液')
    expect(screen.getByText(/非系统医学验证/)).toBeTruthy()
  })
})
