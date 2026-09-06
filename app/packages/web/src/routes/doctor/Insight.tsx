import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Info,
  LoaderCircle,
  PackageCheck,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react'
import { fetchInsightPatients, generateInsightSummary, type InsightSummaryDto } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RiskBadge } from '@/components/domain/RiskBadge'
import type { RiskLevel } from '@anxin/shared'

/** 临期/低库存药品项（shared dto 里为 z.unknown()，本处窄化为具体形态）。 */
interface ExpiryItem {
  id: string
  genericName: string
  expiry: string | null
  days?: number
}

/**
 * 医生端洞察页（M3-T3 · PRD §7.7 / spec §T3）——迁移 demo/doctor.tsx。
 *
 * 三屏结构：
 *   1. 患者列表（PatientListView）：卡片网格，点击生成摘要；
 *   2. 加载中骨架（PatientSummarySkeleton）；
 *   3. 摘要视图（PatientSummaryView）：依从性 + 用药清单 + 相互作用 + 临期库存 + 风险事件 + Agent 摘要 + 数据快照。
 *
 * ⚠️ 独立分支（/doctor/*），无底部导航（DoctorLayout 已处理）；
 *    数据源从 demo 的 mock JSON 改读 PostgreSQL（spec §T3）。
 */

export default function Insight() {
  const patientsQuery = useQuery({ queryKey: ['insight', 'patients'], queryFn: fetchInsightPatients })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [summary, setSummary] = useState<InsightSummaryDto | null>(null)

  const summaryMutation = useMutation({
    mutationFn: (patientId: string) => generateInsightSummary(patientId),
    onSuccess: (data) => setSummary(data),
  })

  const handlePick = (patientId: string) => {
    setSelectedId(patientId)
    setSummary(null)
    summaryMutation.mutate(patientId)
  }

  const handleBack = () => {
    setSelectedId(null)
    setSummary(null)
  }

  // 摘要视图
  if (selectedId && summary) {
    return <PatientSummaryView summary={summary} onBack={handleBack} />
  }

  // 加载中骨架
  if (selectedId && summaryMutation.isPending) {
    const patient = patientsQuery.data?.find((p) => p.id === selectedId)
    return <PatientSummarySkeleton patientName={patient?.name ?? '患者'} onBack={handleBack} />
  }

  // 患者列表
  return (
    <PatientListView
      patients={patientsQuery.data ?? []}
      loading={patientsQuery.isLoading}
      error={patientsQuery.error ? '患者列表加载失败，请确认后端服务已启动' : ''}
      onPick={handlePick}
    />
  )
}

// ---------------------------------------------------------------------------
// 患者列表
// ---------------------------------------------------------------------------

function PatientListView({
  patients,
  loading,
  error,
  onPick,
}: {
  patients: Awaited<ReturnType<typeof fetchInsightPatients>>
  loading: boolean
  error: string
  onPick: (id: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">医生端 · 演示</p>
          <h1 className="text-xl font-bold">患者洞察</h1>
        </div>
        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold">
          {patients.length} 名患者
        </span>
      </div>

      <Card className="border-risk-l2/30 bg-risk-l2/5">
        <CardContent className="flex items-start gap-2 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-risk-l2" aria-hidden />
          <p className="text-muted-foreground">
            选择患者生成诊前摘要。Agent 调用依从性、相互作用、临期库存、风险事件等只读工具，再由 LLM
            组装摘要并过安全守门。本页仅供演示，不用于真实诊疗。
          </p>
        </CardContent>
      </Card>

      {loading && (
        <p className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <LoaderCircle className="size-6 animate-spin" aria-hidden /> 正在加载患者列表…
        </p>
      )}

      {error && (
        <p className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <AlertTriangle className="size-6 text-risk-l3" aria-hidden />
          {error}
        </p>
      )}

      {!loading && !error && patients.length === 0 && (
        <p className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Stethoscope className="size-6" aria-hidden />
          暂无患者数据
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {patients.map((p) => (
          <Card
            key={p.id}
            className="cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/30"
            onClick={() => onPick(p.id)}
          >
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
                  {(p.name ?? '患')[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-bold">{p.name ?? '未命名'}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.age ? `${p.age} 岁 · ` : ''}
                    {p.gender ?? '未知'}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {p.conditions.map((c) => (
                  <span key={c} className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs">
                    {c}
                  </span>
                ))}
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {p.drugCount} 种药
                </span>
              </div>

              <p className="text-xs text-muted-foreground">
                最近活跃 {p.lastActiveAt ?? '无记录'}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 加载中骨架
// ---------------------------------------------------------------------------

function PatientSummarySkeleton({ patientName, onBack }: { patientName: string; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={onBack} className="min-h-9">
        <ChevronLeft className="size-4" aria-hidden />
        返回患者列表
      </Button>
      <p className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <LoaderCircle className="size-6 animate-spin" aria-hidden />
        正在为 {patientName} 生成诊前摘要…
        <span className="text-xs">Agent 正在调用只读工具并组装摘要</span>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 摘要视图
// ---------------------------------------------------------------------------

function PatientSummaryView({ summary, onBack }: { summary: InsightSummaryDto; onBack: () => void }) {
  const { patient, sections, tools, snapshot, riskLevel, citations, notice } = summary
  const adherence = tools.adherence

  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={onBack} className="min-h-9">
        <ChevronLeft className="size-4" aria-hidden />
        返回患者列表
      </Button>

      {/* 患者头部 */}
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
            {(patient.name ?? '患')[0]}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold">{patient.name ?? '未命名'}</h2>
            <p className="text-sm text-muted-foreground">
              {patient.age ? `${patient.age} 岁 · ` : ''}
              {patient.gender ?? '未知'}
              {patient.conditions.length > 0 ? ` · ${patient.conditions.join('、')}` : ''}
            </p>
          </div>
          <RiskBadge level={riskLevel} showHint={false} />
        </CardContent>
      </Card>

      {/* notice（降级/过滤提示） */}
      {notice && (
        <Card className="border-risk-l3/30 bg-risk-l3/5">
          <CardContent className="flex items-start gap-2 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-risk-l3" aria-hidden />
            <p className="text-muted-foreground">{notice}</p>
          </CardContent>
        </Card>
      )}

      {/* 依从性 */}
      <SectionHeading eyebrow="工具输出" title="依从性" />
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${adherence.rate >= 60 ? 'bg-risk-l1' : 'bg-risk-l3'}`}
              style={{ width: `${adherence.rate}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              执行率 <strong className="text-base">{adherence.rate}%</strong>
            </span>
            <span>
              已服 <strong>{adherence.taken}</strong>/{adherence.total}
            </span>
            <span>
              漏服 <strong>{adherence.skipped}</strong>
            </span>
            {adherence.consecutiveSkip > 0 && (
              <span className="text-risk-l3">
                连续漏服 <strong>{adherence.consecutiveSkip}</strong> 次
              </span>
            )}
          </div>
          {adherence.consecutiveSkip > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-risk-l3/30 bg-risk-l3/10 p-2.5 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-risk-l3" aria-hidden />
              <div>
                <strong className="text-risk-l3">连续漏服警示</strong>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  近 {adherence.skipDetails.length} 次漏服：{adherence.skipDetails.map((s) => s.date).join('、')}
                  。建议诊间询问漏服原因。
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 用药清单与相互作用 */}
      <SectionHeading eyebrow="工具输出" title="用药清单与相互作用" />
      <div className="grid gap-2 sm:grid-cols-2">
        {tools.medicationList.map((m) => (
          <Card key={m.id}>
            <CardContent className="space-y-1 p-3 text-sm">
              <strong className="font-semibold">{m.genericName}</strong>
              <dl className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div>
                  <dt className="font-medium text-foreground/80">规格</dt>
                  <dd>{m.specification ?? '—'}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground/80">库存</dt>
                  <dd>{m.stock ? `${m.stock.value} ${m.stock.unit}` : '—'}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground/80">效期</dt>
                  <dd>{m.expiry ?? '—'}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      {tools.interactions.hasInteraction ? (
        <Card className="border-risk-l3/30 bg-risk-l3/5">
          <CardContent className="space-y-1 p-3 text-sm">
            <div className="flex items-center gap-2 text-risk-l3">
              <AlertTriangle className="size-4" aria-hidden />
              <strong>相互作用提示</strong>
            </div>
            {tools.interactions.items.map((i, idx) => (
              <p key={idx} className="text-xs text-muted-foreground">
                {i.level}：{i.note}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-risk-l1/30 bg-risk-l1/5">
          <CardContent className="flex items-center gap-2 p-3 text-sm">
            <ShieldCheck className="size-4 text-risk-l1" aria-hidden />
            <p className="text-muted-foreground">未见明确药物相互作用。</p>
          </CardContent>
        </Card>
      )}

      {tools.expiry.expiring.length > 0 && (
        <Card className="border-risk-l3/30 bg-risk-l3/5">
          <CardContent className="space-y-1 p-3 text-sm">
            <div className="flex items-center gap-2 text-risk-l3">
              <AlertTriangle className="size-4" aria-hidden />
              <strong>临期药品</strong>
            </div>
            {(tools.expiry.expiring as unknown as ExpiryItem[]).map((m) => (
              <p key={m.id} className="text-xs text-muted-foreground">
                {m.genericName} · {m.expiry} 到期（剩 {m.days} 天）
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {tools.expiry.lowStock.length > 0 && (
        <Card>
          <CardContent className="flex items-center gap-2 p-3 text-sm">
            <PackageCheck className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-muted-foreground">
              低库存：{(tools.expiry.lowStock as unknown as ExpiryItem[]).map((m) => m.genericName).join('、')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* 风险事件与咨询 */}
      <SectionHeading eyebrow="工具输出" title="风险事件与咨询" />
      {tools.riskEvents.events.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-3">
            {tools.riskEvents.events.map((e, idx) => (
              <div key={idx} className="flex items-start gap-2 text-sm">
                <RiskBadge level={e.level as RiskLevel} showHint={false} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <strong className="text-xs">{e.type}</strong>
                  <p className="text-xs text-muted-foreground">
                    {e.date} · {e.detail}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-risk-l1/30 bg-risk-l1/5">
          <CardContent className="flex items-center gap-2 p-3 text-sm">
            <ShieldCheck className="size-4 text-risk-l1" aria-hidden />
            <p className="text-muted-foreground">近 30 天无 L3/L4 风险事件。</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex items-start gap-2 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">
            累计咨询 {tools.riskEvents.consultCount} 次，被安全规则拦截 {tools.riskEvents.blockedCount} 次。
            {tools.riskEvents.lastQuestion ? `最近提问："${tools.riskEvents.lastQuestion}"` : ''}
          </p>
        </CardContent>
      </Card>

      {/* Agent 摘要 */}
      <SectionHeading
        eyebrow="Agent 摘要"
        title="诊前摘要"
        chip={snapshot.mode === 'llm' ? 'LLM 生成' : '规则降级'}
      />
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">简明结论</span>
            <p className="text-sm font-semibold">{sections.summary}</p>
          </div>

          {sections.keyPoints.length > 0 && (
            <div className="space-y-1">
              <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Info className="size-3.5" aria-hidden />
                关键发现
              </h4>
              <ul className="space-y-1 pl-1 text-sm">
                {sections.keyPoints.map((k) => (
                  <li key={k} className="flex items-start gap-2">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                    <span>{k}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sections.risks.length > 0 && (
            <div className="space-y-1">
              <h4 className="flex items-center gap-1.5 text-xs font-medium text-risk-l3">
                <AlertTriangle className="size-3.5" aria-hidden />
                风险提示
              </h4>
              <ul className="space-y-1 pl-1 text-sm">
                {sections.risks.map((r) => (
                  <li key={r} className="flex items-start gap-2">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-risk-l3" aria-hidden />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5">
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-muted-foreground">下一步</span>
              <p className="text-sm font-semibold">{sections.nextAction}</p>
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {sections.warning}
          </p>
        </CardContent>
      </Card>

      {/* 数据快照 */}
      <Card>
        <CardContent className="space-y-1 p-3 text-xs text-muted-foreground">
          <strong className="text-sm text-foreground">数据快照</strong>
          <p>生成时间：{snapshot.generatedAt}</p>
          <p>数据区间：{snapshot.dateRange}</p>
          <p>工具链：{snapshot.toolChain.join(' → ')}</p>
          <p>来源：{citations.join('；')}</p>
        </CardContent>
      </Card>

      {/* 免责声明 */}
      <Card className="border-risk-l3/30 bg-risk-l3/5">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-risk-l3" aria-hidden />
          <div>
            <strong className="text-sm text-risk-l3">仅供参考</strong>
            <p className="mt-1 text-xs text-muted-foreground">
              本摘要基于患者自报数据与 Mock 演示数据，由 Agent 调用只读工具并经安全守门生成，不构成诊疗或用药调整依据。请向患者核实后依处方判断。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 通用小组件
// ---------------------------------------------------------------------------

function SectionHeading({ eyebrow, title, chip }: { eyebrow: string; title: string; chip?: string }) {
  return (
    <div className="flex items-center justify-between pt-2">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
        <h3 className="text-base font-bold">{title}</h3>
      </div>
      {chip && (
        <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold">
          {chip}
        </span>
      )}
    </div>
  )
}
