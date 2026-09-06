import type { ReactNode } from 'react'
import { CalendarClock, Check, Clock3, ListChecks, Package, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { DOSE_UNITS, suggestTimes, type TagKind } from '@anxin/shared'
import { TagBadge } from './TagBadge'
import {
  hasTranscribed,
  resolveCycle,
  sigNeedsManual,
  stockDays,
  type ConfirmFormState,
  type CycleChoice,
  type DraftPayload,
} from '@/lib/draft'

const CYCLES: { value: CycleChoice; title: string; desc: (days: number) => string }[] = [
  { value: 'longterm', title: '长期服用', desc: () => '开放式 · 无结束日期，持续提醒直到暂停/结束' },
  { value: 'until-used', title: '用完为止', desc: (days) => (days > 0 ? `按库存推算约 ${days} 天（推算）` : '按库存推算 · 库存未知，确认后可在药箱补录' ) },
  { value: 'custom', title: '自定义天数', desc: () => '封闭式 · 结束日期自动推算' },
]

/** 核对行外壳：标签 + 内容 + 标注徽章 + 「已核对」勾选（抄录值必须逐项勾，PRD §7.2.5）。 */
function VerifyRow({
  label,
  tag,
  checked,
  onCheck,
  hint,
  children,
}: {
  label: string
  tag?: TagKind | null
  checked?: boolean
  onCheck?: () => void
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{label}</span>
        <TagBadge kind={tag} />
        {onCheck && (
          <label className="ml-auto flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              className="size-5"
              aria-label={`已核对${label}`}
              checked={Boolean(checked)}
              onChange={onCheck}
            />
            已核对
          </label>
        )}
      </div>
      {children}
      {hint && <p className="text-xs text-risk-l3">{hint}</p>}
    </div>
  )
}

/**
 * 医嘱核对卡（PRD §7.2.5：用量 / 频次 / 疗程**无差别逐项核对**，不因置信度高跳过）。
 * 抄录值可改（改后标注降为「自填」）；needsManual / sigMissing 覆盖项**恒为空输入** + 原文该行提示，绝不预填。
 */
export function SigCard({
  payload,
  state,
  patch,
}: {
  payload: DraftPayload
  state: ConfirmFormState
  patch: (partial: Partial<ConfirmFormState>) => void
}) {
  const plan = payload.planDraft
  if (!plan) return null

  const doseTranscribed = hasTranscribed(payload, 'dose')
  const freqTranscribed = hasTranscribed(payload, 'frequency')
  const durationTranscribed = hasTranscribed(payload, 'duration')
  const doseManual = sigNeedsManual(payload, 'dose')
  const freqManual = sigNeedsManual(payload, 'frequency')
  const dateMissing = (payload.needsManual ?? []).includes('date')
  const days = stockDays(payload, state)
  const { endDate } = resolveCycle(payload, state)
  const unitOptions = [state.doseUnit, ...(DOSE_UNITS as readonly string[])].filter(
    (u, i, list) => u && list.indexOf(u) === i,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListChecks className="size-5 text-primary" aria-hidden />
          医嘱核对
          <span className="text-xs font-normal text-muted-foreground">只抄录不生成 · 三项关键字段逐项核对</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VerifyRow
          label="每次用量"
          tag={doseTranscribed && Number(state.doseValue) === (plan.dose?.value ?? NaN) && state.doseUnit === plan.dose?.unit ? 'transcribed' : 'user'}
          checked={state.checked.dose}
          onCheck={doseTranscribed ? () => patch({ checked: { ...state.checked, dose: !state.checked.dose } }) : undefined}
          hint={
            doseManual
              ? `规则未从原文抽出用量 —— 请对照原文人工补，系统不预填猜测。原文该行：${payload.item?.usage || '（该行缺失或被涂黑）'}`
              : undefined
          }
        >
          <div className="flex gap-2">
            <Input
              type="number"
              min={0.5}
              step={0.5}
              aria-label="每次用量"
              className="flex-1"
              value={state.doseValue}
              placeholder={doseManual ? '人工补录' : ''}
              onChange={(e) => patch({ doseValue: e.target.value })}
            />
            <select
              aria-label="用量单位"
              value={state.doseUnit}
              onChange={(e) => patch({ doseUnit: e.target.value })}
              className="min-h-11 rounded-md border border-input bg-background px-2 text-sm"
            >
              {unitOptions.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
        </VerifyRow>

        <VerifyRow
          label="频次"
          tag={freqTranscribed && Number(state.frequency) === plan.frequency ? 'transcribed' : 'user'}
          checked={state.checked.frequency}
          onCheck={freqTranscribed ? () => patch({ checked: { ...state.checked, frequency: !state.checked.frequency } }) : undefined}
          hint={
            freqManual
              ? `规则未从原文抽出频次 —— 请对照原文人工补。原文该行：${payload.item?.usage || '（该行缺失或被涂黑）'}`
              : undefined
          }
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={8}
              aria-label="每日几次"
              className="w-28"
              value={state.frequency}
              placeholder={freqManual ? '人工补录' : ''}
              onChange={(e) => patch({ frequency: e.target.value })}
            />
            <span className="text-sm text-muted-foreground">次 / 日</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto min-h-10"
              disabled={!Number(state.frequency)}
              onClick={() => patch({ times: suggestTimes(Number(state.frequency)) })}
            >
              按频次生成时间点建议
            </Button>
          </div>
        </VerifyRow>

        <VerifyRow label="途径" tag={plan.route && state.route === plan.route ? 'transcribed' : state.route ? 'user' : undefined}>
          <Input
            aria-label="用药途径"
            value={state.route}
            placeholder="如：滴眼 / 口服（原文未抽出可留空）"
            onChange={(e) => patch({ route: e.target.value })}
          />
        </VerifyRow>

        <VerifyRow
          label="开始日期"
          tag={state.startDate === plan.startDate ? plan.tags?.startDate ?? 'default' : 'user'}
          hint={dateMissing ? '处方日期在原文中缺失或被涂黑 —— 此处为系统默认值（今天），请核对后修改。' : undefined}
        >
          <Input
            type="date"
            aria-label="开始日期"
            className="w-48"
            value={state.startDate}
            onChange={(e) => patch({ startDate: e.target.value })}
          />
        </VerifyRow>

        <VerifyRow
          label="疗程"
          tag={durationTranscribed && !state.cycleOverride ? 'transcribed' : 'user'}
          checked={state.checked.duration}
          onCheck={
            durationTranscribed && !state.cycleOverride
              ? () => patch({ checked: { ...state.checked, duration: !state.checked.duration } })
              : undefined
          }
          hint={
            !durationTranscribed
              ? '原文没有疗程 —— 请三选一（长期服用 / 用完为止 / 自定义天数），系统不替你决定。'
              : undefined
          }
        >
          {durationTranscribed && !state.cycleOverride ? (
            <div className="space-y-2">
              <p className="text-base font-bold">
                共 {plan.durationDays} 天 · 结束日期 {endDate || '—'}
                <TagBadge kind="derived" className="ml-2" />
              </p>
              <Button variant="outline" size="sm" className="min-h-10" onClick={() => patch({ cycleOverride: true })}>
                与实物/医嘱不符 · 改用其他疗程形态
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {CYCLES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => patch({ cycle: c.value })}
                  className={cn(
                    'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left',
                    state.cycle === c.value ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background',
                  )}
                >
                  <span className="font-semibold">{c.title}</span>
                  <span className="text-xs opacity-80">{c.desc(days)}</span>
                </button>
              ))}
              {state.cycle === 'custom' && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    aria-label="疗程天数"
                    className="w-24"
                    value={state.customDays}
                    onChange={(e) => patch({ customDays: e.target.value })}
                  />
                  <span className="text-sm text-muted-foreground">天（结束日期自动推算）</span>
                </div>
              )}
              {state.cycleOverride && (
                <Button variant="ghost" size="sm" className="min-h-10" onClick={() => patch({ cycleOverride: false })}>
                  <X className="size-4" aria-hidden /> 恢复处方抄录疗程（共 {plan.durationDays} 天）
                </Button>
              )}
            </div>
          )}
        </VerifyRow>

        <VerifyRow label="服药要求" tag="default">
          <select
            aria-label="服药要求"
            value={state.meal}
            onChange={(e) => patch({ meal: e.target.value })}
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {['无特殊要求', '饭前', '饭后', '随餐', '睡前'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </VerifyRow>
      </CardContent>
    </Card>
  )
}

/** 服药时间点卡（PRD §7.3.3：系统建议永不冒充医嘱，标「辅助」且可改）。 */
export function TimesCard({
  payload,
  state,
  patch,
}: {
  payload: DraftPayload
  state: ConfirmFormState
  patch: (partial: Partial<ConfirmFormState>) => void
}) {
  if (!payload.planDraft) return null
  const sameAsSuggested = JSON.stringify(state.times) === JSON.stringify(payload.planDraft.times ?? [])
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Clock3 className="size-5 text-primary" aria-hidden />
          服药时间点
          <TagBadge kind={sameAsSuggested ? 'assist' : 'user'} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {state.times.map((time, idx) => (
            <span key={`${time}-${idx}`} className="inline-flex items-center gap-1 rounded-full border border-input bg-background px-2 py-1">
              <input
                type="time"
                aria-label={`时间点 ${idx + 1}`}
                value={time}
                onChange={(e) => patch({ times: state.times.map((t, i) => (i === idx ? e.target.value : t)) })}
                className="bg-transparent text-sm"
              />
              <button type="button" aria-label={`删除时间点 ${idx + 1}`} onClick={() => patch({ times: state.times.filter((_, i) => i !== idx) })}>
                <X className="size-4 text-muted-foreground" aria-hidden />
              </button>
            </span>
          ))}
          <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => patch({ times: [...state.times, '08:00'] })}>
            <Plus className="size-4" aria-hidden /> 添加
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          建议按频次在 8:00–22:00 均匀分布生成（每日 4 次 → 8/12/16/20），是<strong>辅助</strong>建议、不是医嘱，可自由调整。
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * 无计划草稿时的两步式提示（入口B 药盒建档 / 处方降级无正文）。
 * 红线：药盒与医院标签上的用法用量**绝不**自动抄录（PRD V2.1 §0.1），故此处不提供任何用法用量预填。
 */
export function NoPlanCard({ payload }: { payload: DraftPayload }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Package className="size-5 text-primary" aria-hidden />
          本次仅建档 · 计划稍后手动创建
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="flex items-start gap-2 rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-3 text-risk-l3">
          <CalendarClock className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            {payload.labelNotice
              ? '检测到医院标签层：标签用法不会被自动抄录。'
              : payload.type === 'drug'
                ? '药盒上没有医嘱用法用量，系统不会替你生成。'
                : '本次未能从处方原文抽出用法用量。'}
            确认后请到「药箱」为该药<strong>手动创建计划</strong>（按处方 / 说明书 / 药师指导填写），创建时会跑说明书范围校验与相互作用检查。
          </span>
        </p>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Check className="mt-0.5 size-4 shrink-0 text-risk-l1" aria-hidden />
          已理解：本次不产生服药计划（药盒/标签结构上不含医嘱用法用量，非遗漏）。
        </p>
      </CardContent>
    </Card>
  )
}
