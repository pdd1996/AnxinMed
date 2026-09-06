import { Check, Info, OctagonX, HeartPulse, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { INTERACTION_LEVEL_ORDER, type InteractionLevel } from '@anxin/shared'
import type { confirmDraft } from '@/api/client'
import type { DraftPayload } from '@/lib/draft'

/** confirm 响应（含对**最终确认值**重跑的规则检查）。 */
export type ConfirmResult = Awaited<ReturnType<typeof confirmDraft>>
type Interaction = NonNullable<DraftPayload['interactions']>
type DosageRange = NonNullable<DraftPayload['dosageRange']>
type Hit = Interaction['hits'][number]
type Issue = DosageRange['issues'][number]

/** 相互作用四级 → 分级色 + 图标（禁忌 > 慎用 > 需监测 > 注意；老年向不单靠颜色）。 */
const LEVEL_META: Record<InteractionLevel, { icon: typeof Info; className: string }> = {
  禁忌: { icon: OctagonX, className: 'border-risk-l4/40 bg-risk-l4/10 text-risk-l4' },
  慎用: { icon: TriangleAlert, className: 'border-risk-l3/40 bg-risk-l3/10 text-risk-l3' },
  需监测: { icon: HeartPulse, className: 'border-risk-l2/40 bg-risk-l2/10 text-risk-l2' },
  注意: { icon: Info, className: 'border-risk-l2/35 bg-risk-l2/10 text-risk-l2' },
}

function sortedHits(hits: Hit[]): Hit[] {
  return [...(hits ?? [])].sort((a, b) => (INTERACTION_LEVEL_ORDER[b.level] ?? 0) - (INTERACTION_LEVEL_ORDER[a.level] ?? 0))
}

/** 命中项列表（确认前草稿值 / 确认后重跑值共用）。 */
function HitList({ hits }: { hits: Hit[] }) {
  return (
    <ul className="space-y-2">
      {sortedHits(hits).map((hit, i) => {
        const meta = LEVEL_META[hit.level] ?? LEVEL_META['注意']
        const Icon = meta.icon
        return (
          <li key={`${hit.level}-${i}`} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${meta.className}`}>
            <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span className="min-w-0">
              <strong className="mr-2 rounded-full bg-background/70 px-2 py-0.5 text-xs">{hit.level}</strong>
              {hit.note}
              <span className="mt-1 block text-xs opacity-85">
                涉及：{(hit.drugNames ?? []).join('、') || '—'} · 来源：{hit.source}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** 相互作用检查结果区（PRD §7.8.2：提示不阻止创建、不自动改方案）。 */
export function InteractionCard({ result }: { result: Interaction | null }) {
  const hits = result?.hits ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          相互作用检查
          <span className="text-xs font-normal text-muted-foreground">对象：本药 × 你当前生效的计划集合</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {hits.length > 0 ? (
          <>
            <HitList hits={hits} />
            <p className="text-xs text-muted-foreground">
              提示<strong>不阻止</strong>确认、也不会替你改方案 —— 请带着这条提示咨询医生或药师。
            </p>
          </>
        ) : (
          <p className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-risk-l1" aria-hidden />
            <span>{result?.coverageNote ?? '当前生效计划集合未见已知相互作用。规则库为演示抄录、覆盖有限，未覆盖不表示无风险。'}</span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** 说明书范围校验结果区（PRD §8.3：仅标注留痕，绝不阻止创建）。 */
export function DosageRangeCard({ result }: { result: DosageRange | null }) {
  const status = result?.status ?? 'none'
  const issues: Issue[] = result?.issues ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Info className="size-5 text-primary" aria-hidden />
          说明书范围校验
          <span className="text-xs font-normal text-muted-foreground">对照说明书库上限 · 仅标注不阻止</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {status === 'pass' && (
          <p className="flex items-start gap-2 rounded-lg border border-risk-l1/35 bg-risk-l1/10 p-3 text-sm text-risk-l1">
            <Check className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              医嘱在说明书范围内{result?.basis ? `（依据：${result.basis}）` : ''}。
            </span>
          </p>
        )}
        {status === 'exceed' && (
          <div className="space-y-2">
            <ul className="space-y-2">
              {issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-3 text-sm text-risk-l3">
                  <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <span>
                    <strong className="mr-1">{issue.field === 'frequency' ? '频次' : '单次用量'}</strong>
                    处方/填写值 {issue.planValue} · 说明书上限 {issue.insertMax}
                    <span className="mt-1 block text-xs opacity-90">{issue.insertNote}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              仅标注留痕、不阻止确认（处方可能有意超说明书用量）。请向开方医生或药师确认后再服用。
              {result?.basis ? ` 依据：${result.basis}` : ''}
            </p>
          </div>
        )}
        {status === 'none' && (
          <p className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
            <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span>{result?.note ?? '说明书库未收录该药的结构化用法用量，本次跳过范围校验（跳过 ≠ 无风险）。'}</span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * 确认成功后的规则检查结果（对**用户最终确认值**重跑，可能与草稿时不同 —— 例如改了频次或在冲突清单里换了候选）。
 * 只在有发现时弹出：让用户在跳转前真的看到风险；无发现则直接 toast + 跳转。
 */
export function ConfirmResultDialog({
  result,
  drugName,
  onDone,
}: {
  result: ConfirmResult
  drugName: string
  onDone: () => void
}) {
  const hits = result.interactions?.hits ?? []
  const issues = result.dosageRange?.issues ?? []
  const worst = sortedHits(hits)[0]?.level
  return (
    <Dialog open onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">已写入药箱：{drugName}</DialogTitle>
          <DialogDescription>
            按你最终确认的值重跑了规则检查{worst ? `，最高级别为「${worst}」` : ''}。提示不阻止、不改方案，请知悉后再用药。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {hits.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-bold">相互作用（{hits.length} 条）</p>
              <HitList hits={hits} />
            </div>
          )}
          {issues.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-bold">超出说明书范围（{issues.length} 项）</p>
              <ul className="space-y-1 text-sm">
                {issues.map((issue, i) => (
                  <li key={i} className="rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-2 text-risk-l3">
                    {issue.field === 'frequency' ? '频次' : '单次用量'} {issue.planValue} · 上限 {issue.insertMax} —— {issue.insertNote}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.interactions?.coverageNote && hits.length === 0 && (
            <p className="text-xs text-muted-foreground">{result.interactions.coverageNote}</p>
          )}
          <Button className="min-h-11 w-full" onClick={onDone}>
            我已知悉，去药箱
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
