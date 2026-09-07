/**
 * T7 · 患者下钻打卡时序图表卡片冒烟测试。
 *
 * jsdom 无 canvas：mock @antv/g2（Chart 链式 API）与 @/api/client 传输层；
 * 断言数据链路（query → 两张图数据 + 汇总文案）、窗口切换触发重查、空态与错误态可见。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PatientAdherenceCharts } from './PatientAdherenceCharts'
import type { InsightAdherenceSeriesDto } from '@/api/client'

const mocks = vi.hoisted(() => ({
  fetchPatientAdherenceSeries: vi.fn(),
}))
vi.mock('@/api/client', () => mocks)

// G2 5 fluent API 链式 mock：记录调用即可，render 即刻 resolve
const chartInstance = vi.hoisted(() => {
  const obj: Record<string, ReturnType<typeof vi.fn>> = {
    render: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  }
  for (const m of [
    'interval',
    'line',
    'data',
    'encode',
    'transform',
    'scale',
    'axis',
    'legend',
    'coordinate',
    'style',
    'animate',
  ]) {
    obj[m] = vi.fn().mockReturnThis()
  }
  return obj
})
vi.mock('@antv/g2', () => ({ Chart: vi.fn(() => chartInstance) }))

const today = '2026-09-07'
const yesterday = '2026-09-06'
const fixture: InsightAdherenceSeriesDto = {
  ok: true,
  patientId: 'p-1',
  days: 30,
  startDate: '2026-08-09',
  endDate: today,
  series: [
    { date: yesterday, taken: 2, skipped: 0, later: 0, expected: 2 },
    { date: today, taken: 1, skipped: 1, later: 0, expected: 3 },
  ],
  byDrug: [
    { genericName: '测试药A', brandName: null, taken: 3, skipped: 1, later: 0 },
  ],
  adherence: { rate: 75, taken: 3, skipped: 1, total: 4 },
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PatientAdherenceCharts patientId="p-1" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.fetchPatientAdherenceSeries.mockResolvedValue(fixture)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PatientAdherenceCharts', () => {
  it('加载后渲染两张图 + 窗口执行率汇总文案，G2 收到按日堆叠数据', async () => {
    renderCard()
    await waitFor(() => expect(screen.getByRole('img', { name: '按日打卡堆叠柱状图' })).toBeTruthy())
    expect(screen.getByRole('img', { name: '按药品打卡数量水平条形图' })).toBeTruthy()
    expect(screen.getByText(/近 30 天执行率 75%（已服 3\/4）/)).toBeTruthy()
    // interval mark 至少各收到一次 data（按日图 + 按药品图），且编码了 color=kind
    expect(chartInstance.interval).toHaveBeenCalled()
    expect(chartInstance.encode).toHaveBeenCalledWith('color', 'kind')
    expect(mocks.fetchPatientAdherenceSeries).toHaveBeenCalledWith('p-1', 30)
  })

  it('切换窗口（近 7 天）→ 以 days=7 重新请求', async () => {
    renderCard()
    await waitFor(() => expect(screen.getByRole('img', { name: '按日打卡堆叠柱状图' })).toBeTruthy())
    fireEvent.click(screen.getByText('近 7 天'))
    await waitFor(() =>
      expect(mocks.fetchPatientAdherenceSeries).toHaveBeenCalledWith('p-1', 7),
    )
  })

  it('窗口内无打卡记录 → 空态文案可见（不静默白图）', async () => {
    mocks.fetchPatientAdherenceSeries.mockResolvedValue({
      ...fixture,
      series: [{ date: today, taken: 0, skipped: 0, later: 0, expected: 0 }],
      byDrug: [],
      adherence: { rate: 0, taken: 0, skipped: 0, total: 0 },
    })
    renderCard()
    await waitFor(() => expect(screen.getByText(/近 30 天无打卡记录，暂无按药品统计/)).toBeTruthy())
  })

  it('加载失败 → 错误卡片可见（禁止静默吞错）', async () => {
    mocks.fetchPatientAdherenceSeries.mockRejectedValue(new Error('数据库连接失败'))
    renderCard()
    await waitFor(() => expect(screen.getByText('打卡数据加载失败')).toBeTruthy())
    expect(screen.getByText('数据库连接失败')).toBeTruthy()
  })
})
