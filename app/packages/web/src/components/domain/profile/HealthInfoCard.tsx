import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, Trash2, UserRound } from 'lucide-react'
import { client, fetchProfile, unwrap } from '@anxin/core'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { HEALTH_FIELDS, ageFromBirthMonth, formatBirthMonth, type HealthField } from '@anxin/shared'

type ProfileDto = Awaited<ReturnType<typeof fetchProfile>>
type HealthEntry = ProfileDto['items'][number]

/** 字段级示例文案（老年向：给一格就填一格，不猜格式）。 */
const FIELD_PLACEHOLDER: Partial<Record<HealthField, string>> = {
  过敏史: '如：青霉素',
  诊断: '如：高血压、2型糖尿病（你报告的诊断）',
  特殊状态: '如：孕期、安装心脏起搏器',
  紧急联系人: '如：李四 13800000000',
  年龄: '如：68',
}

const BIRTH_MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1))

/** 字段值展示：出生年月格式化成「1958年6月」（存储仍是 1958-06），别的字段原样。 */
function displayValueOf(field: HealthField, raw: string): string {
  if (field !== '出生年月') return raw
  return formatBirthMonth(raw) ?? raw
}

/**
 * 健康信息卡（PRD §7.1.2 入口一，视觉参照蚂蚁阿福「编辑家庭成员」分组表单卡）：
 * HEALTH_FIELDS 七字段常驻展示——已填显示值+来源标注，未填显示「待补充 >」点行即填，
 * 替代旧「下拉选字段+填内容+添加」。逐条来源标注为 PRD 硬要求，分级视觉：
 * 「用户自述」弱化灰字，「处方笺抄录 · 已确认」品牌色强调。
 * 编辑/补充共用一个弹窗；删除走弹窗内二次确认（行上一键即删已移除，防误触）。
 * 手动保存一律由服务端标 source='self_reported'（profiles.service）。
 *
 * 「年龄」与「出生年月」联动（2026-11-19）：填了出生年月即按周岁自动算年龄，年龄行改只读展示
 * 「按出生年月自动计算」，避免同一件事填两遍；未填出生年月时才允许手填年龄（只知年龄的老人）。
 *
 * 「出生年月」输入自 2026-11-19 起不再用浏览器原生 `<input type="month">`：Chrome 的弹层是从当前年份
 * 往回滚的年列表（2026 年要往回滚到 1958 有近 70 行），底部还挂着与出生无关的「清除 / 本月」，老人基本上选不对。
 * 改成「4 位年份输入 + 12 个月份大按钮」：无弹层、跨浏览器一致（Safari/Firefox 本就不支持 month），
 * 月份一次点中；填好当场回显「1958年6月 · 自动计算 68 岁」，让老人自己就能核对填对了没有。
 *
 * `showHeader=false` 用于「健康信息」一级页：页头已给出标题与说明，卡内不再重复标题行。
 */
export function HealthInfoCard({ showHeader = true }: { showHeader?: boolean }) {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['profile'], queryFn: fetchProfile })
  const entries = data?.items ?? []

  // 服务端按 fieldKey upsert（理论唯一）；防御性取首条。
  const byField = useMemo(() => {
    const map = new Map<string, HealthEntry>()
    for (const entry of entries) {
      if (!map.has(entry.fieldKey)) map.set(entry.fieldKey, entry)
    }
    return map
  }, [entries])

  // 出生年月 → 周岁联动：有出生年月时，年龄由它算出来（年份/月份变化后刷新即更新，不用重填）。
  const birthEntry = byField.get('出生年月') ?? null
  const derivedAge = ageFromBirthMonth(birthEntry?.value ?? '')
  // 列表与「修改出生年月」说明里的展示形态（1958-06 → 1958年6月）；脏数据回退原值。
  const birthDisplay = birthEntry ? displayValueOf('出生年月', birthEntry.value ?? '') : ''

  const [editing, setEditing] = useState<{ field: HealthField; entry: HealthEntry | null } | null>(null)
  const [value, setValue] = useState('')
  // 出生年月单独拆「年 / 月」两个子值：年份可敲、月份点大按钮，保存时拼回 "YYYY-MM"。
  const [birthYear, setBirthYear] = useState('')
  const [birthMonth, setBirthMonth] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [showingDerivedAge, setShowingDerivedAge] = useState(false)

  // 出生年月校验：未来月份算不出周岁、且写库会得到无意义数据；超高龄同样算不出（= null），一并拦下。
  const now = new Date()
  const currentBirthMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const isBirth = editing?.field === '出生年月'
  const birthCandidate =
    /^\d{4}$/.test(birthYear) && birthMonth !== '' ? `${birthYear}-${birthMonth.padStart(2, '0')}` : ''
  const birthAge = birthCandidate ? ageFromBirthMonth(birthCandidate) : null
  const birthFuture = birthCandidate !== '' && birthCandidate > currentBirthMonth
  const birthValid = birthCandidate !== '' && birthAge !== null
  // 出生年月走自己的 draft（校验通过才可保存）；其他字段沿用单输入框的值。
  const draft = isBirth ? (birthValid ? birthCandidate : '') : value.trim()

  const patch = useMutation({
    mutationFn: async (payload: { upserts?: { fieldKey: string; value: string }[]; deletes?: string[] }) => {
      const res = await client.api.profile.$patch({ json: payload })
      return unwrap(res)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  })

  function openEditor(field: HealthField, entry: HealthEntry | null) {
    setEditing({ field, entry })
    setValue(entry?.value ?? '')
    if (field === '出生年月') {
      // 回填：老数据可能不补零（"1958-6"），月份换算成按钮的 1–12。
      const [year = '', month = ''] = (entry?.value ?? '').split('-')
      const monthNumber = Number(month)
      setBirthYear(/^\d{4}$/.test(year) ? year : '')
      setBirthMonth(monthNumber >= 1 && monthNumber <= 12 ? String(monthNumber) : '')
    } else {
      setBirthYear('')
      setBirthMonth('')
    }
    setConfirmingDelete(false)
    setShowingDerivedAge(false)
  }
  function closeEditor() {
    setEditing(null)
    setConfirmingDelete(false)
    setShowingDerivedAge(false)
    setValue('')
    setBirthYear('')
    setBirthMonth('')
  }
  function handleSave() {
    if (!editing || !draft) return
    const upserts = [{ fieldKey: editing.field, value: draft }]
    // 保存出生年月时把算出的年龄一并写库：换端/换页读到的年龄与出生年月一致（都是用户自述派生）。
    if (editing.field === '出生年月' && birthAge !== null) {
      upserts.push({ fieldKey: '年龄', value: String(birthAge) })
    }
    patch.mutate({ upserts }, { onSuccess: closeEditor })
  }
  function handleDelete() {
    if (!editing) return
    patch.mutate({ deletes: [editing.field] }, { onSuccess: closeEditor })
  }

  return (
    <Card className="gap-0 py-0">
      {showHeader ? (
        <CardHeader className="border-b px-4 py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="size-5 text-primary" aria-hidden />
            健康信息
          </CardTitle>
          <CardAction>
            <span className="text-xs font-normal text-muted-foreground">点按行可补充或修改</span>
          </CardAction>
        </CardHeader>
      ) : null}
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {HEALTH_FIELDS.map((field) => {
            const entry = byField.get(field)
            const isAge = field === '年龄'
            // 有出生年月时年龄只读展示派生值（出生年月是唯一真相），没填时才允许手填。
            const derived = isAge && derivedAge !== null ? derivedAge : null
            const displayValue = derived !== null ? String(derived) : displayValueOf(field, entry?.value ?? '')
            const filled = Boolean(displayValue.trim())
            const confirmed = derived === null && entry?.sourceMeta?.source === 'prescription_confirmed'
            return (
              <li key={field}>
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50 active:bg-muted"
                  onClick={() => {
                    if (derived !== null) {
                      setEditing(null)
                      setShowingDerivedAge(true)
                    } else {
                      openEditor(field, entry ?? null)
                    }
                  }}
                >
                  <span className="shrink-0 font-semibold">{field}</span>
                  {filled ? (
                    <span className="min-w-0 flex-1 text-right">
                      <span className="block whitespace-pre-wrap break-words text-sm font-medium line-clamp-2">
                        {displayValue}
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 block text-xs',
                          confirmed ? 'font-medium text-primary' : 'text-muted-foreground',
                        )}
                      >
                        {derived !== null ? '按出生年月自动计算' : confirmed ? '处方笺抄录 · 已确认' : '用户自述'}
                      </span>
                    </span>
                  ) : (
                    <span className="flex-1 text-right text-sm text-muted-foreground">待补充</span>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      </CardContent>

      <Dialog open={editing !== null || showingDerivedAge} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="sm:max-w-md">
          {editing && confirmingDelete ? (
            <>
              <DialogHeader>
                <DialogTitle>删除「{editing.field}」</DialogTitle>
                <DialogDescription>确定删除这条健康信息？删除后如需恢复要重新填写。</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
                  取消
                </Button>
                <Button variant="destructive" disabled={patch.isPending} onClick={handleDelete}>
                  确认删除
                </Button>
              </DialogFooter>
            </>
          ) : editing ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {editing.entry ? '编辑' : '补充'}「{editing.field}」
                </DialogTitle>
              </DialogHeader>
              {editing.field === '性别' ? (
                <div className="grid grid-cols-2 gap-3">
                  {(['男', '女'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={value === g}
                      onClick={() => setValue(g)}
                      className={cn(
                        'flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 text-base font-semibold transition-colors',
                        value === g
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-input bg-background text-muted-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-5 place-items-center rounded-full border-2',
                          value === g ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                        )}
                      >
                        {value === g && <Check className="size-3.5" aria-hidden />}
                      </span>
                      {g}
                    </button>
                  ))}
                </div>
              ) : editing.field === '出生年月' ? (
                <BirthMonthPicker
                  year={birthYear}
                  month={birthMonth}
                  onYearChange={(next) => setBirthYear(next.replace(/\D/g, '').slice(0, 4))}
                  onMonthChange={setBirthMonth}
                />
              ) : (
                <Input
                  aria-label={`${editing.field}（内容）`}
                  inputMode={editing.field === '年龄' ? 'numeric' : undefined}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={FIELD_PLACEHOLDER[editing.field]}
                  autoFocus
                />
              )}
              {isBirth ? (
                <BirthMonthHint
                  year={birthYear}
                  month={birthMonth}
                  candidate={birthCandidate}
                  age={birthAge}
                  future={birthFuture}
                />
              ) : null}
              <DialogFooter className="sm:justify-between">
                {editing.entry ? (
                  <Button
                    variant="ghost"
                    className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    <Trash2 className="size-4" aria-hidden /> 删除
                  </Button>
                ) : null}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={closeEditor}>
                    取消
                  </Button>
                  <Button disabled={!draft || patch.isPending} onClick={handleSave}>
                    保存
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : showingDerivedAge && derivedAge !== null ? (
            <>
              <DialogHeader>
                <DialogTitle>年龄</DialogTitle>
                <DialogDescription>
                  「出生年月 {birthDisplay}」自动算出 {derivedAge} 岁。改年龄请直接改出生年月，两项会同步。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={closeEditor}>
                  取消
                </Button>
                <Button onClick={() => openEditor('出生年月', birthEntry)}>修改出生年月</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/**
 * 出生年月选择器：4 位年份输入 + 12 个月份大按钮（触控 ≥44px，见 `touch-target` 令牌）。
 * 原生 `<input type="month">` 的弹层是「年份列表 + 清除/本月」，对出生年月既难滚又无关，故不用（见文件头）。
 */
function BirthMonthPicker({
  year,
  month,
  onYearChange,
  onMonthChange,
}: {
  year: string
  month: string
  onYearChange: (next: string) => void
  onMonthChange: (next: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="health-birth-year">出生年份</Label>
        <div className="flex items-center gap-2">
          <Input
            id="health-birth-year"
            inputMode="numeric"
            autoComplete="bday-year"
            maxLength={4}
            value={year}
            onChange={(e) => onYearChange(e.target.value)}
            placeholder="如 1958"
            className="h-12 w-36 text-center text-lg font-semibold tracking-widest"
            autoFocus
          />
          <span className="text-base font-semibold text-muted-foreground" aria-hidden>
            年
          </span>
        </div>
      </div>
      <div className="space-y-2">
        <span id="health-birth-month-label" className="block text-sm font-medium">
          出生月份
        </span>
        <div
          role="group"
          aria-labelledby="health-birth-month-label"
          className="grid grid-cols-4 gap-2"
        >
          {BIRTH_MONTH_OPTIONS.map((option) => {
            const selected = month === option
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                onClick={() => onMonthChange(option)}
                className={cn(
                  'touch-target rounded-xl border-2 text-base font-semibold transition-colors',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background text-foreground hover:bg-muted',
                )}
              >
                {Number(option)}月
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * 出生年月状态行（aria-live，老人边填边得到回执）：
 * 填全且算得出周岁 → 「1958年6月 · 自动计算 68 岁」；填错 → 说明为什么不能保存；没填全 → 提示下一步。
 */
function BirthMonthHint({
  year,
  month,
  candidate,
  age,
  future,
}: {
  year: string
  month: string
  candidate: string
  age: number | null
  future: boolean
}) {
  if (candidate !== '' && age !== null) {
    return (
      <p aria-live="polite" className="text-sm font-medium text-primary">
        {formatBirthMonth(candidate)} · 自动计算 {age} 岁
      </p>
    )
  }
  if (candidate !== '' && age === null) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {future ? '出生年月不能晚于当前月份，否则算不出年龄。' : '这个年份算不出年龄，请核对后重填。'}
      </p>
    )
  }
  let hint = '先填出生年份，再点出生月份。'
  if (year.length === 4) hint = '再点一下出生月份。'
  else if (year.length > 0) hint = '年份要填 4 位数字，例如 1958。'
  else if (month !== '') hint = '再填 4 位出生年份。'
  return (
    <p aria-live="polite" className="text-xs text-muted-foreground">
      {hint}
    </p>
  )
}
