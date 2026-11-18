import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, LoaderCircle } from 'lucide-react'
import {
  computeRange,
  fetchRecords,
  recordsToCsv,
  RECORD_STATUS_LABEL,
  type RangeMode,
} from '@anxin/core'
import { Button } from '@/components/ui/button'
import { BackLink } from '@/components/layout/BackLink'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * 服药记录页（M3-T6 · PRD §7.4）：按「今天/本周/本月」查明细 + CSV 导出。
 * 层级：粒度切换 → 明细标题（导出是这一区的次要动作）→ 区间与条数说明 → 记录列表。
 * 导出不再是页面主视觉——低频的「数据导出」不该和主流程按钮同权重。
 */
const MODES: { key: RangeMode; label: string }[] = [
  { key: 'day', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
]

/** 区间自然语言（不用 2026-11-16 ~ 2026-11-18 这种机器格式）。 */
function formatRange(mode: RangeMode, from: string, to: string): string {
  const md = (iso: string) => {
    const [, month, day] = iso.split('-')
    return `${Number(month)}月${Number(day)}日`
  }
  return mode === 'day' ? md(from) : `${md(from)} – ${md(to)}`
}

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
      <BackLink />
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">服药记录</p>

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

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">记录明细</h1>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-9"
          onClick={exportCsv}
          disabled={items.length === 0}
          aria-label="导出 CSV"
        >
          <Download className="size-4" aria-hidden /> 导出
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {formatRange(mode, from, to)}
        {summary
          ? ` · 共 ${summary.total} 条 · 已服 ${summary.taken} · 漏服 ${summary.skipped} · 延后 ${summary.later}`
          : ''}
      </p>

      <Card>
        <CardContent className="space-y-3 pt-6">
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
    </div>
  )
}
