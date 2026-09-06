import { useEffect, useState } from 'react'
import { CalendarClock, Plus, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { DOSE_UNITS, addDaysStr, suggestTimes, todayStr, type CycleType } from '@anxin/shared'

export interface PlanFormResult {
  dose: { value: number; unit: string }
  frequency: number
  times: string[]
  meal: string
  cycleType: CycleType
  endDate?: string
}

const MEALS = ['无特殊要求', '饭前', '饭后', '随餐', '睡前']

const CYCLES: { value: CycleType; title: string; desc: string }[] = [
  { value: 'open', title: '长期服用', desc: '开放式 · 无结束日期' },
  { value: 'stock', title: '用完为止', desc: '按库存推算可用天数' },
  { value: 'closed', title: '自定义天数', desc: '封闭式 · 推算结束日期' },
]

/**
 * 手动建 / 编辑服药计划弹窗（任务书 T9，参照 demo PlanModal）。
 * 医嘱只抄录不生成：用量/频次/时间点由用户按处方/说明书/药师指导填写，时间点建议（suggestTimes）标「辅助」可改。
 */
export function PlanModal({
  open,
  drugName,
  drugSpec,
  defaultUnit,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  drugName: string
  drugSpec?: string | null
  defaultUnit?: string
  initial?: {
    dose: { value: number; unit: string }
    frequency: number
    times: string[]
    meal?: string | null
    cycleType: CycleType
  }
  onClose: () => void
  onSave: (data: PlanFormResult) => void
}) {
  const [doseValue, setDoseValue] = useState(String(initial?.dose.value ?? 1))
  const [doseUnit, setDoseUnit] = useState(initial?.dose.unit ?? defaultUnit ?? '片')
  const [frequency, setFrequency] = useState(String(initial?.frequency ?? 3))
  const [times, setTimes] = useState<string[]>(initial?.times ?? suggestTimes(3))
  const [meal, setMeal] = useState(initial?.meal ?? '无特殊要求')
  const [cycle, setCycle] = useState<CycleType>(initial?.cycleType ?? 'open')
  const [customDays, setCustomDays] = useState('7')
  const [agreed, setAgreed] = useState(false)

  // 频次变化时重算建议时间点（标「辅助」，可改）；编辑已有计划时不覆盖。
  useEffect(() => {
    if (!initial) setTimes(suggestTimes(Number(frequency) || 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency])

  const valid =
    Number(doseValue) > 0 &&
    Number(frequency) > 0 &&
    times.length > 0 &&
    agreed &&
    (cycle !== 'closed' || Number(customDays) > 0)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">{initial ? '编辑服药计划' : '创建服药计划'}</DialogTitle>
          <DialogDescription>
            请严格按照医生处方、说明书或药师指导填写——系统不会替你生成用量。当前药品：{drugName}
            {drugSpec ? ` · ${drugSpec}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pl-dose">每次用量</Label>
              <div className="flex gap-2">
                <Input
                  id="pl-dose"
                  type="number"
                  min={0.5}
                  step={0.5}
                  className="flex-1"
                  value={doseValue}
                  onChange={(e) => setDoseValue(e.target.value)}
                />
                <select
                  aria-label="用量单位"
                  value={doseUnit}
                  onChange={(e) => setDoseUnit(e.target.value)}
                  className="min-h-11 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {DOSE_UNITS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pl-freq">频次（每日次数）</Label>
              <Input
                id="pl-freq"
                type="number"
                min={1}
                max={8}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pl-meal">服药要求</Label>
            <select
              id="pl-meal"
              value={meal}
              onChange={(e) => setMeal(e.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {MEALS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>服药时间点（建议可改）</Label>
            <div className="flex flex-wrap items-center gap-2">
              {times.map((time, idx) => (
                <span key={idx} className="inline-flex items-center gap-1 rounded-full border border-input bg-background px-2 py-1">
                  <input
                    type="time"
                    aria-label={`时间点 ${idx + 1}`}
                    value={time}
                    onChange={(e) => setTimes((cur) => cur.map((t, i) => (i === idx ? e.target.value : t)))}
                    className="bg-transparent text-sm"
                  />
                  <button type="button" aria-label="删除时间点" onClick={() => setTimes((cur) => cur.filter((_, i) => i !== idx))}>
                    <X className="size-3.5 text-muted-foreground" aria-hidden />
                  </button>
                </span>
              ))}
              <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={() => setTimes((cur) => [...cur, '08:00'])}>
                <Plus className="size-3.5" aria-hidden /> 添加
              </Button>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">辅助</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label>周期形态</Label>
            <div className="grid grid-cols-1 gap-2">
              {CYCLES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCycle(c.value)}
                  className={cn(
                    'flex min-h-11 items-center justify-between rounded-lg border px-3 py-2 text-left text-sm',
                    cycle === c.value ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background',
                  )}
                >
                  <span className="font-semibold">{c.title}</span>
                  <span className="text-xs opacity-80">{c.desc}</span>
                </button>
              ))}
            </div>
            {cycle === 'closed' && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  aria-label="疗程天数"
                  className="w-24"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">天（结束日期自动推算）</span>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={agreed} onChange={() => setAgreed(!agreed)} className="size-5" />
            此用量来自处方、说明书或药师指导
          </label>
        </div>

        <Button
          className="min-h-11 w-full"
          disabled={!valid}
          onClick={() =>
            onSave({
              dose: { value: Number(doseValue), unit: doseUnit },
              frequency: Number(frequency),
              times,
              meal,
              cycleType: cycle,
              endDate: cycle === 'closed' ? addDaysStr(todayStr(), Number(customDays)) : undefined,
            })
          }
        >
          <CalendarClock className="size-4" aria-hidden />
          {initial ? '保存计划' : '确认创建计划'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
