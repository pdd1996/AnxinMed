import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChevronRight, Hand, ListChecks, LoaderCircle, X } from 'lucide-react'
import { confirmDraft, fetchDraft, rejectDraft, type DraftDto } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { OriginalPanel } from '@/components/domain/draft/OriginalPanel'
import { IdentityCard } from '@/components/domain/draft/IdentityCard'
import { NoPlanCard, SigCard, TimesCard } from '@/components/domain/draft/SigCard'
import { HealthCard, WhoCard } from '@/components/domain/draft/HealthCard'
import {
  ConfirmResultDialog,
  DosageRangeCard,
  InteractionCard,
  type ConfirmResult,
} from '@/components/domain/draft/RiskCards'
import { useIntakeSession } from '@/stores/intakeSession'
import { buildConfirm, initialConfirmState, unmetReasons, type ConfirmFormState } from '@/lib/draft'
import { CONFIRM_STATUS_META } from '@anxin/shared'

/**
 * 草稿确认页（M2-T7 · PRD §7.2.5 / §10.2）—— 录入主线的**唯一闸门**。
 *
 * 左列原文对照（会话内原图整图展示 + 文字原文对照；取不到图则纯文字降级），
 * 右列结构化字段逐项核对（身份 / 医嘱 / 时间点 / 健康建议 / 规则检查 / 使用人）。
 * 确认走 POST /api/drafts/:id/confirm（服务端单事务原子写四表 + 确认留痕，并对最终确认值重跑规则检查）；
 * 「信息不符」走 POST /api/drafts/:id/reject 后回重拍或手动建档（PRD §7.2.6）。
 */
export default function Draft() {
  const { id } = useParams<{ id: string }>()
  const query = useQuery({
    queryKey: ['draft', id],
    queryFn: () => fetchDraft(id as string),
    enabled: Boolean(id),
  })

  if (query.isLoading) {
    return (
      <p className="flex items-center gap-2 py-16 text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-hidden /> 正在载入草稿…
      </p>
    )
  }

  if (query.error || !query.data) {
    return (
      <Card>
        <CardContent className="space-y-3 py-10 text-center">
          <AlertTriangle className="mx-auto size-8 text-risk-l3" aria-hidden />
          <h1 className="text-lg font-bold">草稿读取失败</h1>
          <p className="text-sm text-muted-foreground">
            {query.error instanceof Error ? query.error.message : '草稿不存在或已被处理。'}
          </p>
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/box">
              回到药箱 <ChevronRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return <DraftConfirm key={query.data.id} draft={query.data} />
}

function DraftConfirm({ draft }: { draft: DraftDto }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const payload = draft.payload
  const [state, setState] = useState<ConfirmFormState>(() => initialConfirmState(payload))
  const [mismatchOpen, setMismatchOpen] = useState(false)
  const [result, setResult] = useState<ConfirmResult | null>(null)
  // 原图只在内存会话里（stores/intakeSession，绝不持久化）；取不到 → OriginalPanel 走文字对照降级
  const imageUrl = useIntakeSession((s) => s.imageByDraftId[draft.id])

  const patch = (partial: Partial<ConfirmFormState>) => setState((s) => ({ ...s, ...partial }))
  const reasons = unmetReasons(payload, state)
  const drugName = state.manual.genericName || payload.drugDraft.genericName || payload.item?.drugName || '本药'

  const invalidate = () => {
    for (const key of [['drugs'], ['plans'], ['tasks', 'today'], ['profile'], ['draft', draft.id]]) {
      queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const confirm = useMutation({
    mutationFn: () => confirmDraft(draft.id, buildConfirm(payload, state)),
    onSuccess: (res) => {
      useIntakeSession.getState().clear([draft.id]) // 原图即用即弃
      invalidate()
      const risky = (res.interactions?.hits.length ?? 0) > 0 || res.dosageRange?.status === 'exceed'
      if (risky) {
        setResult(res) // 有风险发现 → 跳转前让用户真的看到（只标注不阻止）
        return
      }
      goBox(res)
    },
  })

  /** 确认后跳转：带计划 → 药箱；无计划（入口B/降级）→ 药箱并直接打开该药的计划弹窗（两步式录入）。 */
  function goBox(res: ConfirmResult) {
    if (res.planId) {
      toast.success('已确认：药品已入药箱，计划已生效')
      navigate('/box')
      return
    }
    toast.success('已确认：药品已入药箱。请为该药手动创建计划（药盒/标签用法不会被自动抄录）')
    navigate(`/box?plan=${res.drugId}`)
  }

  const reject = useMutation({
    mutationFn: (reason: string) => rejectDraft(draft.id, reason),
    onSuccess: (_res, reason) => {
      useIntakeSession.getState().clear([draft.id])
      invalidate()
      setMismatchOpen(false)
      if (reason.includes('手动建档')) {
        toast.info('已标记信息不符，请在药箱页手动建档')
        navigate('/box?manual=1')
        return
      }
      toast.info('已标记信息不符，请重新拍摄')
      navigate(payload.type === 'prescription' ? '/intake/rx' : '/intake/drug')
    },
  })

  // 已确认/已拒绝的草稿 → 只读态（防重复操作）。
  // 例外：result 非空时（刚确认完、正展示重跑规则检查结果）不切只读 —— 否则 confirm 后的
  // invalidate 回读到 status=confirmed 会把本页提前换成只读卡，结果弹窗还没被看到就被卸载（UI 竞态）。
  if (draft.status !== 'pending' && !result) {
    const confirmed = draft.status === 'confirmed'
    return (
      <Card>
        <CardContent className="space-y-3 py-10 text-center">
          {confirmed ? (
            <Check className="mx-auto size-8 text-risk-l1" aria-hidden />
          ) : (
            <X className="mx-auto size-8 text-muted-foreground" aria-hidden />
          )}
          <h1 className="text-lg font-bold">本草稿已{confirmed ? '确认' : '被标记信息不符'}</h1>
          <p className="text-sm text-muted-foreground">
            {confirmed ? '药品与计划已写入档案，可在药箱查看。' : '未写入任何档案数据；请重新拍摄或手动建档。'}
          </p>
          <Button asChild className="min-h-11">
            <Link to="/box">
              去药箱 <ChevronRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const statusMeta = CONFIRM_STATUS_META[payload.drugDraft.confirmStatus ?? 'manual']

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
          Draft confirmation · 唯一闸门 · {payload.entry === 'A' ? '入口A 处方笺' : '入口B 药品'}
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">草稿确认{payload.item ? `：${payload.item.drugName}` : ''}</h1>
            <p className="text-sm text-muted-foreground">
              凡进档案，最后一道门是你 —— 用量、频次、疗程三项<strong>无差别逐项核对</strong>，不因识别置信度高而跳过。
            </p>
          </div>
          <span
            className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground"
            title={statusMeta.hint}
          >
            {statusMeta.label}
          </span>
        </div>
      </header>

      {payload.degraded && (
        <p className="flex items-start gap-2 rounded-xl border border-risk-l4/40 bg-risk-l4/10 p-3 text-sm text-risk-l4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            <strong className="mr-1">识别降级（{payload.degraded.code}）：</strong>
            {payload.degraded.message}
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <OriginalPanel payload={payload} imageUrl={imageUrl} />
        </div>

        <div className="space-y-4">
          <IdentityCard payload={payload} state={state} patch={patch} />
          {payload.planDraft ? (
            <>
              <SigCard payload={payload} state={state} patch={patch} />
              <TimesCard payload={payload} state={state} patch={patch} />
            </>
          ) : (
            <NoPlanCard payload={payload} />
          )}
          <HealthCard payload={payload} state={state} patch={patch} />
          <InteractionCard result={payload.interactions ?? null} />
          {payload.planDraft && <DosageRangeCard result={payload.dosageRange ?? null} />}
          {payload.type === 'prescription' && <WhoCard state={state} patch={patch} />}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 py-4">
          {reasons.length > 0 && (
            <ul className="space-y-1 text-sm text-risk-l3" aria-live="polite">
              {reasons.map((reason) => (
                <li key={reason} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {reason}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="min-h-12 flex-1" onClick={() => setMismatchOpen(true)}>
              <X className="size-4" aria-hidden /> 信息不符
            </Button>
            <Button
              className="min-h-12 flex-[2]"
              disabled={reasons.length > 0 || confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <Check className="size-4" aria-hidden />
              )}
              {payload.planDraft ? '确认建档并生效计划' : '确认建档（计划稍后手动创建）'}
            </Button>
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ListChecks className="mt-0.5 size-4 shrink-0" aria-hidden />
            确认即留痕：药品 ID、确认时间、确认方式与关键字段快照写入来源记录；
            医嘱字段若被你修正，标注会从「抄录」降为「自填」。
          </p>
        </CardContent>
      </Card>

      <Dialog open={mismatchOpen} onOpenChange={(o) => !o && setMismatchOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">信息不符</DialogTitle>
            <DialogDescription>
              识别结果与实物不一致时，回到重拍或手动建档 —— 系统不猜测。本草稿会被标记为已拒绝并留痕。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="min-h-12 w-full justify-between"
              disabled={reject.isPending}
              onClick={() => reject.mutate('用户点信息不符 → 重新拍摄')}
            >
              <span className="flex items-center gap-2">
                <ChevronRight className="size-4" aria-hidden /> 重新拍摄
              </span>
            </Button>
            <Button
              className="min-h-12 w-full justify-between"
              disabled={reject.isPending}
              onClick={() => reject.mutate('用户点信息不符 → 手动建档')}
            >
              <span className="flex items-center gap-2">
                <Hand className="size-4" aria-hidden /> 手动建档
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {result && (
        <ConfirmResultDialog
          result={result}
          drugName={drugName}
          onDone={() => {
            setResult(null)
            goBox(result)
          }}
        />
      )}
    </div>
  )
}
