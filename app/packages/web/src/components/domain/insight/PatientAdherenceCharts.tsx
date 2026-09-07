/**
 * 患者下钻打卡时序图表卡片（T7 · G2 5.x）。
 *
 * 数据：GET /api/insight/patients/:id/adherence-series（0 次 LLM 直查库，口径与队列视图同源——
 * 执行率 = taken / total，expected = shared isPlanActiveOn × 计划时间点数）。
 * 图表：按日打卡堆叠柱（已服/漏服/延后）+ 应服虚线参考；按药品数量水平堆叠条。
 * 颜色读主题 CSS 变量（--risk-l1/--risk-l3/--muted-foreground），明暗主题自动跟随。
 * jsdom 无 canvas：web 测试 mock @antv/g2，本组件保证数据链路与空态/错误态可见。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Chart } from '@antv/g2'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { fetchPatientAdherenceSeries, type InsightAdherenceSeriesDto } from '@/api/client'

const DAY_OPTIONS = [7, 30] as const

/** 打卡三态与颜色（顺序即堆叠顺序；颜色取自主题变量，light/dark 各有取值）。 */
const KINDS = ['已服', '漏服', '延后'] as const
const KIND_VARS = ['--risk-l1', '--risk-l3', '--muted-foreground'] as const

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** 按日堆叠柱 + 应服虚线（G2 5 fluent API；数据变更即销毁重建，cleanup 防 StrictMode 双挂载泄漏）。 */
function DailyCheckinChart({ series, height }: { series: InsightAdherenceSeriesDto['series']; height: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [renderError, setRenderError] = useState(false)

  const bars = useMemo(
    () =>
      series.flatMap((d) => [
        { date: d.date, kind: '已服', count: d.taken },
        { date: d.date, kind: '漏服', count: d.skipped },
        { date: d.date, kind: '延后', count: d.later },
      ]),
    [series],
  )
  const expectLine = useMemo(() => series.map((d) => ({ date: d.date, count: d.expected })), [series])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setRenderError(false)
    const chart = new Chart({ container: el, autoFit: true, height })
    chart
      .interval()
      .data(bars)
      .encode('x', 'date')
      .encode('y', 'count')
      .encode('color', 'kind')
      .transform({ type: 'stackY' })
      .scale('color', {
        domain: [...KINDS],
        range: KIND_VARS.map((v) => cssVar(v, '#888')),
      })
      .axis('x', { labelFormatter: (v: string) => (typeof v === 'string' ? v.slice(5) : String(v)) })
      .legend('color', { position: 'top' })
    if (expectLine.some((r) => r.count > 0)) {
      chart
        .line()
        .data(expectLine)
        .encode('x', 'date')
        .encode('y', 'count')
        .style('stroke', cssVar('--muted-foreground', '#888'))
        .style('lineWidth', 1.5)
        .style('lineDash', [4, 4])
        .animate(false)
    }
    let disposed = false
    chart.render().catch(() => {
      if (!disposed) setRenderError(true) // 渲染失败可见，不静默吞错
    })
    return () => {
      disposed = true
      chart.destroy()
    }
  }, [bars, expectLine, height])

  if (renderError) {
    return <p className="text-sm text-risk-l3">图表渲染失败，请刷新重试。</p>
  }
  return <div ref={ref} role="img" aria-label="按日打卡堆叠柱状图" />
}

/** 按药品水平堆叠条（transpose 坐标系；高度随药品数自适应）。 */
function ByDrugChart({ byDrug }: { byDrug: InsightAdherenceSeriesDto['byDrug'] }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [renderError, setRenderError] = useState(false)
  const height = Math.max(140, byDrug.length * 40 + 40)

  const bars = useMemo(
    () =>
      byDrug.flatMap((d) => [
        { drug: d.genericName, kind: '已服', count: d.taken },
        { drug: d.genericName, kind: '漏服', count: d.skipped },
        { drug: d.genericName, kind: '延后', count: d.later },
      ]),
    [byDrug],
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setRenderError(false)
    const chart = new Chart({ container: el, autoFit: true, height })
    chart.coordinate({ transform: [{ type: 'transpose' }] })
    chart
      .interval()
      .data(bars)
      .encode('x', 'drug')
      .encode('y', 'count')
      .encode('color', 'kind')
      .transform({ type: 'stackY' })
      .scale('color', {
        domain: [...KINDS],
        range: KIND_VARS.map((v) => cssVar(v, '#888')),
      })
      .legend('color', { position: 'top' })
    let disposed = false
    chart.render().catch(() => {
      if (!disposed) setRenderError(true)
    })
    return () => {
      disposed = true
      chart.destroy()
    }
  }, [bars, height])

  if (renderError) {
    return <p className="text-sm text-risk-l3">图表渲染失败，请刷新重试。</p>
  }
  return <div ref={ref} role="img" aria-label="按药品打卡数量水平条形图" />
}

/** 患者下钻打卡时序卡片：窗口切换（7/30 天）+ 两张 G2 图表 + 空态/错误态。 */
export function PatientAdherenceCharts({ patientId }: { patientId: string }) {
  const [days, setDays] = useState<number>(30)
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['insight', 'adherence-series', patientId, days],
    queryFn: () => fetchPatientAdherenceSeries(patientId, days),
  })

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">打卡时序图表</p>
          <div className="flex items-center gap-1" role="group" aria-label="统计窗口">
            {DAY_OPTIONS.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={days === d ? 'default' : 'outline'}
                className="h-7 px-2 text-xs"
                aria-pressed={days === d}
                onClick={() => setDays(d)}
              >
                近 {d} 天
              </Button>
            ))}
          </div>
        </div>

        {isPending ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            正在加载打卡数据…
          </div>
        ) : isError ? (
          <div className="flex items-start gap-2 rounded-md border border-risk-l3/30 bg-risk-l3/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-risk-l3" aria-hidden />
            <div>
              <strong className="text-risk-l3">打卡数据加载失败</strong>
              <p className="mt-0.5 text-xs text-muted-foreground">{error.message}</p>
            </div>
          </div>
        ) : (
          <>
            <DailyCheckinChart series={data.series} height={260} />
            <p className="text-xs text-muted-foreground">
              柱为打卡记录（已服/漏服/延后），虚线为当日应服（生效计划 × 计划时间点）。
              近 {data.days} 天执行率 {data.adherence.rate}%（已服 {data.adherence.taken}/{data.adherence.total}）。
            </p>
            {data.byDrug.length > 0 ? (
              <ByDrugChart byDrug={data.byDrug} />
            ) : (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                近 {data.days} 天无打卡记录，暂无按药品统计。
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
