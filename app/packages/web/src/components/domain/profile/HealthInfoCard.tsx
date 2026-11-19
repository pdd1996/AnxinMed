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
import { cn } from '@/lib/utils'
import { HEALTH_FIELDS, ageFromBirthMonth, type HealthField } from '@anxin/shared'

type ProfileDto = Awaited<ReturnType<typeof fetchProfile>>
type HealthEntry = ProfileDto['items'][number]

/** 字段级示例文案（老年向：给一格就填一格，不猜格式）。出生年月用 month 控件，无需示例。 */
const FIELD_PLACEHOLDER: Partial<Record<HealthField, string>> = {
  过敏史: '如：青霉素',
  诊断: '如：高血压、2型糖尿病（你报告的诊断）',
  特殊状态: '如：孕期、安装心脏起搏器',
  紧急联系人: '如：李四 13800000000',
  年龄: '如：68',
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

  const [editing, setEditing] = useState<{ field: HealthField; entry: HealthEntry | null } | null>(null)
  const [value, setValue] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [showingDerivedAge, setShowingDerivedAge] = useState(false)
  // 出生年月不能晚于当前月份（未来月份算不出周岁，且写库会得到无意义数据）。
  const birthInvalid = editing?.field === '出生年月' && value.trim() !== '' && ageFromBirthMonth(value.trim()) === null
  const now = new Date()
  const currentBirthMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

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
    setConfirmingDelete(false)
    setShowingDerivedAge(false)
  }
  function closeEditor() {
    setEditing(null)
    setConfirmingDelete(false)
    setShowingDerivedAge(false)
    setValue('')
  }
  function handleSave() {
    if (!editing || !value.trim()) return
    const upserts = [{ fieldKey: editing.field, value: value.trim() }]
    // 保存出生年月时把算出的年龄一并写库：换端/换页读到的年龄与出生年月一致（都是用户自述派生）。
    if (editing.field === '出生年月') {
      const age = ageFromBirthMonth(value.trim())
      if (age !== null) upserts.push({ fieldKey: '年龄', value: String(age) })
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
            const displayValue = derived !== null ? String(derived) : entry?.value ?? ''
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
              ) : (
                <Input
                  aria-label={`${editing.field}（内容）`}
                  type={editing.field === '出生年月' ? 'month' : undefined}
                  max={editing.field === '出生年月' ? currentBirthMonth : undefined}
                  inputMode={editing.field === '年龄' ? 'numeric' : undefined}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={FIELD_PLACEHOLDER[editing.field]}
                  autoFocus
                />
              )}
              {birthInvalid ? (
                <p className="text-xs text-destructive">出生年月不能晚于当前月份，否则算不出年龄。</p>
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
                  <Button disabled={!value.trim() || patch.isPending || birthInvalid} onClick={handleSave}>
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
                  「出生年月 {birthEntry?.value ?? ''}」自动算出 {derivedAge} 岁。改年龄请直接改出生年月，两项会同步。
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
