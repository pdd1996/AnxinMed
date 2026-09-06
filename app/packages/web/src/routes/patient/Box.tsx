import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { AlertTriangle, Box as BoxIcon, FileText, Hand, Pause, Pencil, Pill, Play, Plus, ShieldCheck, Square, Trash2 } from 'lucide-react'
import { client, fetchDrugs, fetchPlans, unwrap } from '@/api/client'
import { ManualDrugModal, type ManualDrugForm } from '@/components/domain/ManualDrugModal'
import { PlanModal, type PlanFormResult } from '@/components/domain/PlanModal'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CONFIRM_STATUS_META, type CycleType, type PlanStatus } from '@anxin/shared'

type DrugItem = Awaited<ReturnType<typeof fetchDrugs>>[number]
type PlanItem = Awaited<ReturnType<typeof fetchPlans>>[number]

function planChip(plan?: PlanItem): string {
  if (!plan) return '未创建计划'
  if (plan.status === 'paused') return '已暂停'
  if (plan.status === 'ended') return '已结束'
  if (plan.cycleType === 'open') return '生效中 · 开放式（长期）'
  if (plan.cycleType === 'stock') return '生效中 · 用完为止'
  return `生效中 · 疗程至 ${plan.endDate ?? '—'}`
}

function openedOverdue(drug: DrugItem): boolean {
  if (!drug.openedAt || !drug.expiry) return false
  return new Date(drug.openedAt).getTime() + 180 * 86_400_000 < Date.now()
}

/**
 * 药箱页（任务书 T9，参照 demo Cabinet.tsx）：药卡（身份快照 + 确认状态徽章 + 库存 + 开封/效期）
 * + 手动建档 Modal + 手动建/编辑计划 Modal + 暂停/恢复/结束/删除。数据接 /api/drugs、/api/plans。
 */
export default function Box() {
  const queryClient = useQueryClient()
  const [showManual, setShowManual] = useState(false)
  const [planTarget, setPlanTarget] = useState<{ drug: DrugItem; plan?: PlanItem } | null>(null)

  const drugsQuery = useQuery({ queryKey: ['drugs'], queryFn: fetchDrugs })
  const plansQuery = useQuery({ queryKey: ['plans'], queryFn: fetchPlans })
  const drugs = drugsQuery.data ?? []
  const plans = plansQuery.data ?? []

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['drugs'] })
    queryClient.invalidateQueries({ queryKey: ['plans'] })
    queryClient.invalidateQueries({ queryKey: ['tasks', 'today'] })
  }

  const createDrug = useMutation({
    mutationFn: async (form: ManualDrugForm) => {
      const res = await client.api.drugs.$post({
        json: {
          genericName: form.genericName,
          specification: form.specification,
          form: form.form,
          stock: { value: form.stock, unit: form.stockUnit },
        },
      })
      return unwrap(res)
    },
    onSuccess: () => {
      setShowManual(false)
      invalidate()
    },
  })

  const savePlan = useMutation({
    mutationFn: async (input: { drugId: string; planId?: string; data: PlanFormResult }) => {
      const { drugId, planId, data } = input
      if (planId) {
        const res = await client.api.plans[':id'].$patch({
          param: { id: planId },
          json: { dose: data.dose, frequency: data.frequency, times: data.times, meal: data.meal, cycleType: data.cycleType, endDate: data.endDate ?? null },
        })
        return unwrap(res)
      }
      const res = await client.api.plans.$post({
        json: { drugId, dose: data.dose, frequency: data.frequency, times: data.times, meal: data.meal, cycleType: data.cycleType, endDate: data.endDate ?? null },
      })
      return unwrap(res)
    },
    onSuccess: () => {
      setPlanTarget(null)
      invalidate()
    },
  })

  const patchStatus = useMutation({
    mutationFn: async (input: { planId: string; status: PlanStatus }) => {
      const res = await client.api.plans[':id'].$patch({ param: { id: input.planId }, json: { status: input.status } })
      return unwrap(res)
    },
    onSuccess: invalidate,
  })

  const deleteDrug = useMutation({
    mutationFn: async (drugId: string) => {
      const res = await client.api.drugs[':id'].$delete({ param: { id: drugId } })
      return unwrap(res)
    },
    onSuccess: invalidate,
  })

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">我的药箱</p>
          <h1 className="text-2xl font-bold">所有来源的药，同一个药箱</h1>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => setShowManual(true)}>
            <Hand className="size-4" aria-hidden /> 手动建档
          </Button>
          <Button asChild className="min-h-11">
            <Link to="/intake/rx">
              <Plus className="size-4" aria-hidden /> 拍照录入
            </Link>
          </Button>
        </div>
      </header>

      {drugs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
              <BoxIcon className="size-8" aria-hidden />
            </span>
            <h3 className="text-lg font-bold">药箱还是空的</h3>
            <p className="text-sm text-muted-foreground">拍一张处方笺或药盒照片，识别并确认后加入药箱；也可手动建档。</p>
            <Button asChild className="min-h-11">
              <Link to="/intake/rx">开始录入</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {drugs.map((drug) => {
            const plan = plans.find((p) => p.drugId === drug.id)
            const meta = CONFIRM_STATUS_META[drug.confirmStatus]
            return (
              <Card key={drug.id}>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                      <Pill className="size-6" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground" title={meta.hint}>
                        <ShieldCheck className="size-3.5" aria-hidden />
                        {meta.label}
                      </span>
                      <h3 className="mt-1 truncate text-lg font-bold">{drug.genericName}</h3>
                      <p className="truncate text-sm text-muted-foreground">{drug.brandName ?? ''}</p>
                    </div>
                  </div>

                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">规格</dt>
                      <dd className="font-semibold">{drug.specification ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">库存</dt>
                      <dd className="font-semibold">
                        {drug.stock ? `${drug.stock.value} ${drug.stock.unit}` : '—'}
                        {drug.estimatedStockDays != null && drug.estimatedStockDays > 0 ? `（约 ${drug.estimatedStockDays} 天）` : ''}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">有效期</dt>
                      <dd className="font-semibold">{drug.expiry ?? '待录入'}</dd>
                    </div>
                    {drug.openedAt && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">开封</dt>
                        <dd className="font-semibold">{drug.openedAt}</dd>
                      </div>
                    )}
                  </dl>

                  {openedOverdue(drug) && (
                    <p className="flex items-start gap-1.5 rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-2 text-xs text-risk-l3">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      开封已超说明书效期，建议弃药（以说明书为准）。
                    </p>
                  )}

                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">{planChip(plan)}</span>
                    {plan?.tags?.dose && <span className="rounded-full bg-secondary px-2 py-0.5 font-semibold text-secondary-foreground">抄录/自填用量</span>}
                  </div>
                  {plan && (
                    <p className="text-sm text-muted-foreground">
                      每次 {plan.dose.value} {plan.dose.unit} · 每日 {plan.frequency} 次 · {plan.times.join(' / ')}
                    </p>
                  )}
                  {drug.sourceId && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <FileText className="size-3.5" aria-hidden /> 来源留痕已记录
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" className="min-h-10" onClick={() => setPlanTarget({ drug, plan })}>
                      <Pencil className="size-4" aria-hidden /> {plan ? '编辑计划' : '创建计划'}
                    </Button>
                    {plan && plan.status === 'active' && (
                      <Button variant="ghost" size="sm" className="min-h-10" title="暂停计划" onClick={() => patchStatus.mutate({ planId: plan.id, status: 'paused' })}>
                        <Pause className="size-4" aria-hidden /> 暂停
                      </Button>
                    )}
                    {plan && plan.status === 'paused' && (
                      <Button variant="ghost" size="sm" className="min-h-10" title="恢复计划" onClick={() => patchStatus.mutate({ planId: plan.id, status: 'active' })}>
                        <Play className="size-4" aria-hidden /> 恢复
                      </Button>
                    )}
                    {plan && plan.status !== 'ended' && (
                      <Button variant="ghost" size="sm" className="min-h-10" title="结束计划" onClick={() => patchStatus.mutate({ planId: plan.id, status: 'ended' })}>
                        <Square className="size-4" aria-hidden /> 结束
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="min-h-10 text-destructive" aria-label="删除药品" onClick={() => deleteDrug.mutate(drug.id)}>
                      <Trash2 className="size-4" aria-hidden /> 删除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ManualDrugModal open={showManual} onClose={() => setShowManual(false)} onSave={(form) => createDrug.mutate(form)} />
      {planTarget && (
        <PlanModal
          open
          drugName={planTarget.drug.genericName}
          drugSpec={planTarget.drug.specification}
          defaultUnit={planTarget.drug.stock?.unit}
          initial={
            planTarget.plan
              ? {
                  dose: planTarget.plan.dose,
                  frequency: planTarget.plan.frequency,
                  times: planTarget.plan.times,
                  meal: planTarget.plan.meal,
                  cycleType: planTarget.plan.cycleType as CycleType,
                }
              : undefined
          }
          onClose={() => setPlanTarget(null)}
          onSave={(data) => savePlan.mutate({ drugId: planTarget.drug.id, planId: planTarget.plan?.id, data })}
        />
      )}
    </div>
  )
}
