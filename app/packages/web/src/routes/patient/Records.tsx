import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Download, Info, LoaderCircle } from 'lucide-react'
import { fetchRecords } from '@/api/client'
import { computeRange, recordsToCsv, RECORD_STATUS_LABEL, type RangeMode } from '@/lib/records'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * 服药记录查询与导出页（M3-T6 · PRD §7.4 沿用 V1 §7.5）：按日/周/月查询 + 前端 CSV 导出。
 * 文案口径：记录为用户操作留痕，非医学验证（后端 GET /api/records?from&to，PG 聚合）。
 */
const MODES: { key: RangeMode; label: string }[] = [
  { key: 'day', label: '按日' },
  { key: 'week', label: '按周' },
  { key: 'month', label: '按月' },
]

export default function Records() {
  const [mode, setMode] = useState<RangeMode>('week')
  const { from, to } = computeRange(mode)
  const { data, isLoading } = useQuery({
    queryKey: ['records', from, to],
    queryFn: () => fetchRecords(from, to),
  })
  const items = data?.items ?? []
  const summary = data?.summary

  function exportCsv() {
    const blob = new Blob([recordsToCsv(items)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `服药记录_${from}_${to}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">服药记录</p>
        <h1 className="text-2xl font-bold">查询与导出</h1>
        <p className="text-sm text-muted-foreground">按日 / 周 / 月查看你亲自确认的服药留痕，可导出 CSV。</p>
      </header>

      {/* 粒度切换（老年向：大按钮 + 文字） */}
      <div className="flex gap-2">
        {MODES.map((m) => (
          <Button
            key={m.key}
            type="button"
            variant={mode === m.key ? 'default' : 'outline'}
            className="min-h-11 flex-1"
            onClick={() => setMode(m.key)}
            aria-pressed={mode === m.key}
          >
            {m.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <CalendarDays className="size-5 text-primary" aria-hidden />
              {from} ~ {to}
            </span>
            <Button type="button" size="sm" variant="outline" className="min-h-9" onClick={exportCsv} disabled={items.length === 0}>
              <Download className="size-4" aria-hidden /> 导出 CSV
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {summary && (
            <p className="text-sm text-muted-foreground">
              共 <strong className="text-foreground">{summary.total}</strong> 条 · 已服 {summary.taken} · 跳过{' '}
              {summary.skipped} · 稍后 {summary.later}
            </p>
          )}

          {isLoading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> 正在载入记录…
            </p>
          ) : items.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              该区间暂无服药记录。
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
                  <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
                    {r.scheduledDate} {r.scheduledTime}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{r.drugName}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                      r.status === 'taken'
                        ? 'bg-risk-l1/15 text-risk-l1'
                        : r.status === 'skipped'
                          ? 'bg-risk-l3/15 text-risk-l3'
                          : 'bg-secondary text-secondary-foreground',
                    )}
                  >
                    {RECORD_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        记录为你亲自操作的留痕，非系统医学验证；库存按次扣减。如与实际用药有出入，请以医嘱为准。
      </p>
    </div>
  )
}
