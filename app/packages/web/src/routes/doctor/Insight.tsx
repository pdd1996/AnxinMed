import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Info,
  LoaderCircle,
  MinusCircle,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TriangleAlert,
  UserMinus,
} from 'lucide-react'
import {
  askInsight,
  fetchInsightQueue,
  generateInsightSummary,
  generateQueueSummary,
  toUserMessage,
  unbindPatientAsDoctor,
  useAuthStore,
  type InsightAskDto,
  type InsightQueueDto,
  type InsightSummaryDto,
  type QueueSummaryDto,
} from '@anxin/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { DoctorBindDialog } from '@/components/domain/DoctorBindDialog'
import { RiskBadge, RISK_BADGE_META } from '@/components/domain/RiskBadge'
import { PatientAdherenceCharts } from '@/components/domain/insight/PatientAdherenceCharts'
import { ADHERENCE_GRADE_LABEL, type AdherenceGrade, type RiskEventLevel, type RiskEventType } from '@anxin/shared'
import { cn } from '@/lib/utils'

/** 临期/低库存药品项（shared dto 里为 z.unknown()，本处窄化为具体形态）。 */
interface ExpiryItem {
  id: string
  genericName: string
  expiry: string | null
  days?: number
}

/** 事件类型 → 医生可读标签（api/db/schema.ts risk_events.type 注释同源）。 */
const EVENT_TYPE_LABEL: Record<RiskEventType, string> = {
  emergency: '紧急信号',
  refused: '拒答（停/换药/剂量）',
  'manual-blocked': '拦截个体化解释',
}

/**
 * 风险事件等级展示顺序：风险从高到低。manual-gate（人工档门禁）不是风险分级，
 * 但意味着该药未经 OCR 确认、只能查资料，排在 L3 之后（L1/L2 正常回答不进事件表）。
 */
const RISK_LEVEL_ORDER: RiskEventLevel[] = ['L4', 'L3', 'manual-gate']
const RISK_LEVEL_RANK = Object.fromEntries(RISK_LEVEL_ORDER.map((level, i) => [level, i])) as Record<
  RiskEventLevel,
  number
>

/** 汇总构成里的圆点配色（与 RiskBadge 同源令牌；徽章本身始终带图标 + 中文等级名）。 */
const RISK_LEVEL_DOT: Record<RiskEventLevel, string> = {
  L4: 'bg-risk-l4',
  L3: 'bg-risk-l3',
  'manual-gate': 'bg-muted-foreground/60',
}

/** 时间线行（GET /api/insight/queue 的 riskTimeline 元素：日期 × 级别聚合）。 */
type RiskTimelineItem = InsightQueueDto['riskTimeline'][number]

/**
 * 分档 → 视觉语义（色 token 同 RiskBadge 体系）：
 * 优 = L1 绿 / 中 = L2 蓝 / 差 = L3 橙 / 未分档 = 中性 muted。
 */
const GRADE_META: Record<AdherenceGrade | 'ungraded', { chip: string; bar: string; icon: typeof CircleCheck }> = {
  good: { chip: 'border-risk-l1/35 bg-risk-l1/15 text-risk-l1', bar: 'bg-risk-l1', icon: CircleCheck },
  fair: { chip: 'border-risk-l2/35 bg-risk-l2/15 text-risk-l2', bar: 'bg-risk-l2', icon: MinusCircle },
  poor: { chip: 'border-risk-l3/35 bg-risk-l3/15 text-risk-l3', bar: 'bg-risk-l3', icon: TriangleAlert },
  ungraded: { chip: 'border-border bg-muted text-muted-foreground', bar: 'bg-muted-foreground/40', icon: CircleDashed },
}

/**
 * 医生端洞察页（M3-T3 + T7 · PRD §7.7 / spec §T3+§T7）——迁移 demo/doctor.tsx。
 *
 * 两级结构（T7：队列视图为落地页，患者下钻为显式动作）：
 *   1. 队列视图（QueueView）：分档统计卡 + 依从性分布直方图 + 队列表格（点击下钻）+
 *      风险事件时间线 + 队列摘要（百川末端叙述，0 次 LLM 的数据直查）；
 *   2. 患者摘要流（下钻后）：加载骨架 → 摘要视图（依从性 + 用药清单 + 相互作用 + 临期库存 +
 *      风险事件 + Agent 摘要 + 数据快照）。
 *
 * ⚠️ 独立分支（/doctor/*），无底部导航（DoctorLayout 已处理）；
 *    数据源全部读 PostgreSQL（GET /api/insight/queue 为 0 次 LLM 直查库）。
 */
export default function Insight() {
  const queueQuery = useQuery({ queryKey: ['insight', 'queue'], queryFn: fetchInsightQueue })
  const queryClient = useQueryClient()
  const authMode = useAuthStore((s) => s.mode)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [summary, setSummary] = useState<InsightSummaryDto | null>(null)
  const [queueSummary, setQueueSummary] = useState<QueueSummaryDto | null>(null)

  const summaryMutation = useMutation({
    mutationFn: (patientId: string) => generateInsightSummary(patientId),
    onSuccess: (data) => setSummary(data),
  })

  const queueSummaryMutation = useMutation({
    mutationFn: generateQueueSummary,
    onSuccess: (data) => setQueueSummary(data),
  })

  // specs/25 增补：医生端解除患者（撤销权对称化）；成功后刷新队列并回队列视图。
  const unbindMutation = useMutation({
    mutationFn: (patientId: string) => unbindPatientAsDoctor(patientId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['insight', 'queue'] })
      setSelectedId(null)
      setSummary(null)
    },
  })

  const handlePick = (patientId: string) => {
    unbindMutation.reset()
    setSelectedId(patientId)
    setSummary(null)
    summaryMutation.mutate(patientId)
  }

  const handleBack = () => {
    setSelectedId(null)
    setSummary(null)
  }

  // 患者摘要视图（下钻后）
  if (selectedId && summary) {
    return (
      <PatientSummaryView
        summary={summary}
        onBack={handleBack}
        // 仅真实医生账号（password 模式）可解除；demo 模式保持既有页面（E2E 零回归）。
        onUnbind={authMode === 'password' ? () => unbindMutation.mutate(summary.patient.id) : undefined}
        unbindPending={unbindMutation.isPending}
        unbindError={unbindMutation.error ? toUserMessage(unbindMutation.error, '解除绑定失败，请重试') : null}
      />
    )
  }

  // 加载中骨架
  if (selectedId && summaryMutation.isPending) {
    const patient = queueQuery.data?.patients.find((p) => p.id === selectedId)
    return <PatientSummarySkeleton patientName={patient?.name ?? '患者'} onBack={handleBack} />
  }

  // 队列视图（落地页）
  return (
    <QueueView
      queue={queueQuery.data ?? null}
      loading={queueQuery.isLoading}
      error={queueQuery.error ? '队列数据加载失败，请确认后端服务已启动' : ''}
      summary={queueSummary}
      summaryPending={queueSummaryMutation.isPending}
      onGenerateSummary={() => queueSummaryMutation.mutate()}
      onPick={handlePick}
    />
  )
}

// ---------------------------------------------------------------------------
// 队列视图（T7：分档统计卡 + 图表 + 患者下钻）
// ---------------------------------------------------------------------------

function QueueView({
  queue,
  loading,
  error,
  summary,
  summaryPending,
  onGenerateSummary,
  onPick,
}: {
  queue: InsightQueueDto | null
  loading: boolean
  error: string
  summary: QueueSummaryDto | null
  summaryPending: boolean
  onGenerateSummary: () => void
  onPick: (id: string) => void
}) {
  const authMode = useAuthStore((s) => s.mode)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">患者队列</h1>
          {/* 人数放到标题下方（原来悬在右上角、与标题脱节）；近 N 天为分档统计窗口。 */}
          <p className="mt-0.5 text-sm text-muted-foreground">
            {queue ? `共 ${queue.total} 名患者 · 近 ${queue.dateRange} 天` : '正在加载…'}
          </p>
        </div>
        {/* specs/25：绑定是低频动作，收进弹窗，不再占据队列页首屏（password 模式才出现）。 */}
        {authMode === 'password' && <DoctorBindDialog />}
      </div>

      {loading && (
        <p className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <LoaderCircle className="size-6 animate-spin" aria-hidden /> 正在加载队列数据…
        </p>
      )}

      {error && !loading && (
        <p className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <AlertTriangle className="size-6 text-risk-l3" aria-hidden />
          {error}
        </p>
      )}

      {!loading && !error && queue && (
        <>
          {/* 依从性分布直方图（固定模板 · spec §T7.5）
              原 2×2 分档统计卡与下图完全重复（优/中/差/未分档 + 人数），已删除、只保留带百分比的图。 */}
          <AdherenceHistogram queue={queue} />

          {/* 患者列表（点一行查看该患者摘要；原「按患者下钻」为看板术语，改为白话） */}
          <SectionHeading title="患者列表" />
          <CohortTable queue={queue} onPick={onPick} />

          {/* 风险事件时间线（固定模板） */}
          <SectionHeading title="近 30 天风险事件" />
          <RiskTimeline queue={queue} />

          {/* 队列摘要 */}
          <SectionHeading title="队列摘要" />
          <QueueSummaryPanel
            summary={summary}
            pending={summaryPending}
            onGenerate={onGenerateSummary}
            dateRange={queue.dateRange}
          />

          {/* 医生问答（T7）：队列维度 */}
          <SectionHeading title="向队列提问" />
          <AskPanel patientId={null} />
        </>
      )}
    </div>
  )
}

/** 依从性分布直方图（CSS 条形；数据 = GET /api/insight/queue 的 grades）。 */
function AdherenceHistogram({ queue }: { queue: InsightQueueDto }) {
  const rows = (['good', 'fair', 'poor', 'ungraded'] as const).map((g) => ({
    g,
    label: g === 'ungraded' ? '未分档' : ADHERENCE_GRADE_LABEL[g],
    count: queue.grades[g],
    pct: queue.total > 0 ? Math.round((queue.grades[g] / queue.total) * 100) : 0,
  }))
  return (
    <Card>
      <CardContent className="space-y-2.5 p-4">
        <p className="text-sm font-semibold">依从性分布（近 {queue.dateRange} 天执行率）</p>
        {rows.map((r) => (
          <div key={r.g} className="flex items-center gap-2 text-xs">
            <span className="w-12 shrink-0 text-muted-foreground">{r.label}</span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
              <div
                className={`h-full ${GRADE_META[r.g].bar}`}
                style={{ width: `${Math.max(r.pct, r.count > 0 ? 4 : 0)}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right font-medium">
              {r.count} 人（{r.pct}%）
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** 队列表格（点击行 → 患者摘要下钻）。 */
function CohortTable({ queue, onPick }: { queue: InsightQueueDto; onPick: (id: string) => void }) {
  return (
    <Card>
      <CardContent className="p-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-2 py-2 font-medium">患者</th>
              <th className="hidden px-2 py-2 font-medium sm:table-cell">诊断</th>
              <th className="hidden px-2 py-2 text-center font-medium sm:table-cell">在服</th>
              <th className="px-2 py-2 text-center font-medium">执行率（30 天）</th>
              <th className="hidden px-2 py-2 font-medium sm:table-cell">最近活跃</th>
              <th className="w-8 px-2 py-2" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {queue.patients.map((p) => {
              const grade = p.adherenceGrade ?? 'ungraded'
              const meta = GRADE_META[grade]
              return (
                <tr
                  key={p.id}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-muted/40"
                  onClick={() => onPick(p.id)}
                >
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                        {(p.name ?? '患')[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{p.name ?? '未命名'}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.age ? `${p.age} 岁 · ` : ''}
                          {p.gender ?? '未知'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-2 py-2.5 text-xs text-muted-foreground sm:table-cell">
                    {p.conditions.length > 0 ? p.conditions.join('、') : '—'}
                  </td>
                  <td className="hidden px-2 py-2.5 text-center text-xs sm:table-cell">{p.drugCount} 种</td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="text-xs font-semibold">{p.adherenceRate != null ? `${p.adherenceRate}%` : '—'}</span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${meta.chip}`}>
                        {grade === 'ungraded' ? '未分档' : ADHERENCE_GRADE_LABEL[grade]}
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-2 py-2.5 text-xs text-muted-foreground sm:table-cell">{p.lastActiveAt ?? '无记录'}</td>
                  <td className="px-2 py-2.5">
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

/**
 * 风险事件时间线（固定模板 · 0 次 LLM）。
 *
 * 版式：原来「日期 + 等级 + 起数」逐行平铺，同一天重复三次、等级顺序随库序，宽屏下右侧大片留白。
 * 现改为「汇总条 + 按日分组」两层：
 *   - 汇总条：总起数 / 有记录天数 + 分级构成，L4 直接标「需优先跟进」；
 *   - 每日一行：日期列 → 各等级徽章 + 起数 → 当日小计（右对齐，形成表格节奏）；
 *   - <sm 自动堆叠（日期在徽章上方、隐藏当日小计），不做横向滚动。
 * 风险不单靠颜色传达：每枚徽章都是图标 + 中文等级名。
 */
function RiskTimeline({ queue }: { queue: InsightQueueDto }) {
  const timeline = [...queue.riskTimeline].reverse() // 最新在前
  if (timeline.length === 0) {
    return (
      <Card className="border-risk-l1/30 bg-risk-l1/5">
        <CardContent className="flex items-center gap-2 p-3 text-sm">
          <ShieldCheck className="size-4 shrink-0 text-risk-l1" aria-hidden />
          <p className="text-muted-foreground">近 30 天全体患者无风险拦截事件。</p>
        </CardContent>
      </Card>
    )
  }

  // 按日期归组：日期保持「最新在前」，组内按风险等级从高到低（先看最需要处理的）。
  const byDate = new Map<string, RiskTimelineItem[]>()
  for (const item of timeline) {
    const rows = byDate.get(item.date)
    if (rows) rows.push(item)
    else byDate.set(item.date, [item])
  }
  const days = [...byDate.entries()].map(([date, rows]) => ({
    date,
    rows: [...rows].sort((a, b) => RISK_LEVEL_RANK[a.level] - RISK_LEVEL_RANK[b.level]),
    count: rows.reduce((sum, r) => sum + r.count, 0),
  }))
  const total = days.reduce((sum, d) => sum + d.count, 0)
  const levelTotals = RISK_LEVEL_ORDER.map((level) => ({
    level,
    count: timeline.filter((t) => t.level === level).reduce((sum, t) => sum + t.count, 0),
  })).filter((l) => l.count > 0)
  const hasUrgent = levelTotals.some((l) => l.level === 'L4')

  return (
    <Card className="gap-0 py-0">
      {/* 汇总条：总起数 + 分级构成（原版要在逐行里心算总览） */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border px-4 py-3">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xl font-bold leading-none tabular-nums">{total}</span>
          <span className="text-sm text-muted-foreground">起 · {days.length} 天有记录</span>
        </p>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="按风险等级构成">
          {levelTotals.map(({ level, count }) => (
            <li
              key={level}
              className={cn('inline-flex items-center gap-1.5 text-muted-foreground', level === 'L4' && 'text-risk-l4')}
            >
              <span className={cn('size-1.5 rounded-full', RISK_LEVEL_DOT[level])} aria-hidden />
              <span>{RISK_BADGE_META[level].label}</span>
              <span className="font-semibold tabular-nums">{count}</span>
            </li>
          ))}
          {hasUrgent && <li className="font-semibold text-risk-l4">需优先跟进</li>}
        </ul>
      </div>

      <ul className="divide-y divide-border">
        {days.map((day) => (
          <li
            key={day.date}
            className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[6.5rem_1fr_auto] sm:items-center sm:gap-4"
          >
            <time dateTime={day.date} className="text-xs font-medium tabular-nums text-muted-foreground">
              {day.date}
            </time>
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {day.rows.map((row) => (
                <li key={row.level} className="inline-flex items-center gap-1.5">
                  <RiskBadge level={row.level} showHint={false} />
                  <span className="text-sm font-semibold tabular-nums">{row.count} 起</span>
                </li>
              ))}
            </ul>
            <span className="hidden text-xs text-muted-foreground sm:block sm:text-right">共 {day.count} 起</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 医生问答（T7 · 两级意图路由：固定问法 0 次 LLM 直查库，长尾百川叙述）
// ---------------------------------------------------------------------------

/** 快捷问法（与 api askIntent.ts ASK_SUGGESTIONS 同源口径；首问前展示，响应后以服务端为准）。 */
const ASK_CHIPS: Record<'queue' | 'patient', string[]> = {
  queue: ['依从性分布怎么样？', '执行率差的患者有哪些？', '最近的风险事件汇总'],
  patient: ['他最近依从性怎么样？', '药箱里还有什么药？', '有哪些药快过期了？'],
}

/** toolUsed → 医生可读标签（api 注册表/意图名同源）。 */
const TOOL_USED_LABEL: Record<string, string> = {
  adherence_distribution: '依从性分布',
  patient_cohort: '分档患者队列',
  risk_event_rollup: '风险事件聚合',
  'medication-list': '药箱清单',
  adherence: '依从性统计',
  'expiry-stock': '效期库存',
  'interaction-check': '相互作用检查',
}

/** 单轮问答记录。 */
interface AskExchange {
  question: string
  answer: InsightAskDto | null
  error?: string
}

/** 追问面板（队列视图 patientId=null / 患者摘要视图传患者 id，两处复用）。 */
function AskPanel({ patientId }: { patientId: string | null }) {
  const scope = patientId ? 'patient' : 'queue'
  const [input, setInput] = useState('')
  const [exchanges, setExchanges] = useState<AskExchange[]>([])
  const [pending, setPending] = useState(false)

  const send = async (question: string) => {
    const q = question.trim()
    if (!q || pending) return
    setInput('')
    setPending(true)
    try {
      const answer = await askInsight(q, patientId)
      setExchanges((prev) => [...prev, { question: q, answer }])
    } catch {
      setExchanges((prev) => [...prev, { question: q, answer: null, error: '问答服务暂时不可用，请稍后重试' }])
    } finally {
      setPending(false)
    }
  }

  const chips = exchanges.at(-1)?.answer?.suggestions?.length
    ? exchanges.at(-1)!.answer!.suggestions
    : ASK_CHIPS[scope]

  return (
    <Card>
      <CardContent className="space-y-3 p-4" data-testid="ask-panel">
        {/* 问答线程 */}
        {exchanges.map((ex, i) => (
          <div key={i} className="space-y-1.5" data-testid={i === exchanges.length - 1 ? 'ask-exchange' : undefined}>
            <p className="text-sm font-medium">{ex.question}</p>
            {ex.answer && (
              <div
                className="rounded-md border border-border bg-muted/30 p-2.5 text-sm"
                data-testid={i === exchanges.length - 1 ? 'ask-answer' : undefined}
              >
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  {ex.answer.mode === 'data' ? (
                    <>
                      <span className="rounded-full border border-risk-l1/35 bg-risk-l1/15 px-2 py-0.5 text-[10px] font-semibold text-risk-l1">
                        数据查询
                      </span>
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        来源：{TOOL_USED_LABEL[ex.answer.toolUsed ?? ''] ?? ex.answer.toolUsed}
                      </span>
                    </>
                  ) : (
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      LLM 生成 · 数字来自工具统计
                    </span>
                  )}
                </div>
                <p className="font-semibold">{ex.answer.sections.summary}</p>
                {ex.answer.sections.keyPoints.length > 0 && (
                  <ul className="mt-1 space-y-0.5 pl-1 text-xs text-muted-foreground">
                    {ex.answer.sections.keyPoints.map((k) => (
                      <li key={k}>{k}</li>
                    ))}
                  </ul>
                )}
                {ex.answer.sections.risks.length > 0 && (
                  <ul className="mt-1 space-y-0.5 pl-1 text-xs text-risk-l3">
                    {ex.answer.sections.risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-muted-foreground">{ex.answer.sections.nextAction}</p>
              </div>
            )}
            {ex.error && <p className="text-xs text-risk-l3">{ex.error}</p>}
          </div>
        ))}

        {pending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="ask-pending">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Agent 正在调用只读工具…
          </p>
        )}

        {/* 快捷问法 chips */}
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => send(c)}
              disabled={pending}
              className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/70 disabled:opacity-50"
            >
              {c}
            </button>
          ))}
        </div>

        {/* 输入行 */}
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send(input)
            }}
            placeholder={patientId ? '向 Agent 追问该患者的数据…' : '向 Agent 提问队列数据…'}
            className="min-h-9 flex-1"
            data-testid="ask-input"
          />
          <Button size="sm" onClick={() => void send(input)} disabled={pending || !input.trim()} className="min-h-9" data-testid="ask-send">
            发送
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** 队列摘要面板（百川末端叙述 + guardSummary；无 key / 失败自动规则降级，notice 可见）。 */
function QueueSummaryPanel({
  summary,
  pending,
  onGenerate,
  dateRange,
}: {
  summary: QueueSummaryDto | null
  pending: boolean
  onGenerate: () => void
  dateRange: number
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {!summary && !pending && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
              基于近 {dateRange} 天分档统计与风险事件，生成队列叙述摘要（数字全部来自工具计算结果）。
            </p>
            <Button size="sm" onClick={onGenerate} className="min-h-9">
              <Sparkles className="size-4" aria-hidden />
              生成队列摘要
            </Button>
          </div>
        )}

        {pending && (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" aria-hidden />
            Agent 正在调用只读工具并组装队列摘要…
          </p>
        )}

        {summary && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold">
                {summary.snapshot.mode === 'llm' ? 'LLM 生成' : '规则降级'}
              </span>
              <Button variant="outline" size="sm" onClick={onGenerate} className="min-h-8">
                重新生成
              </Button>
            </div>
            {summary.notice && (
              <p className="flex items-start gap-1.5 rounded-md border border-risk-l3/30 bg-risk-l3/5 p-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-risk-l3" aria-hidden />
                {summary.notice}
              </p>
            )}
            <p className="text-sm font-semibold">{summary.sections.summary}</p>
            {summary.sections.keyPoints.length > 0 && (
              <ul className="space-y-1 pl-1 text-sm">
                {summary.sections.keyPoints.map((k) => (
                  <li key={k} className="flex items-start gap-2">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                    <span>{k}</span>
                  </li>
                ))}
              </ul>
            )}
            {summary.sections.risks.length > 0 && (
              <ul className="space-y-1 pl-1 text-sm">
                {summary.sections.risks.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-risk-l3">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-risk-l3" aria-hidden />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="flex items-start gap-1.5 rounded-md border border-border bg-muted/30 p-2 text-sm">
              <span className="font-medium">下一步：</span>
              {summary.sections.nextAction}
            </p>
          </>
        )}
      </CardContent>
    </Card>
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
        返回队列视图
      </Button>
      <p className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <LoaderCircle className="size-6 animate-spin" aria-hidden />
        正在为 {patientName} 生成诊前摘要…
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 摘要视图（患者下钻后；M3-T3 原三屏结构的第三屏）
// ---------------------------------------------------------------------------

function PatientSummaryView({
  summary,
  onBack,
  onUnbind,
  unbindPending = false,
  unbindError = null,
}: {
  summary: InsightSummaryDto
  onBack: () => void
  /** specs/25 增补：医生端解除绑定（仅 password 模式传入；demo 模式保持既有页面）。 */
  onUnbind?: () => void
  unbindPending?: boolean
  unbindError?: string | null
}) {
  const { patient, sections, tools, snapshot, riskLevel, notice } = summary
  const adherence = tools.adherence
  const [confirmUnbind, setConfirmUnbind] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onBack} className="min-h-9">
          <ChevronLeft className="size-4" aria-hidden />
          返回队列视图
        </Button>

        {onUnbind &&
          (confirmUnbind ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">解除后该患者将从队列移除</span>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-9"
                onClick={() => setConfirmUnbind(false)}
                disabled={unbindPending}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="min-h-9"
                onClick={onUnbind}
                disabled={unbindPending}
              >
                {unbindPending ? '解除中…' : '确认解除'}
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="min-h-9" onClick={() => setConfirmUnbind(true)}>
              <UserMinus className="size-4" aria-hidden />
              解除绑定
            </Button>
          ))}
      </div>

      {unbindError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {unbindError}
        </p>
      )}

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
      <SectionHeading title="依从性" />
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${GRADE_META[adherence.rate >= 95 ? 'good' : adherence.rate >= 80 ? 'fair' : 'poor'].bar}`}
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

      {/* 打卡时序图表（T7 · G2 5.x 前端渲染，数据 0 次 LLM 直查库） */}
      <SectionHeading title="打卡时序图表" />
      <PatientAdherenceCharts patientId={patient.id} />

      {/* 用药清单与相互作用 */}
      <SectionHeading title="用药清单与相互作用" />
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
      <SectionHeading title="风险事件与咨询" />
      {tools.riskEvents.events.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-3">
            {tools.riskEvents.events.map((e, idx) => (
              <div key={idx} className="flex items-start gap-2 text-sm">
                <RiskBadge level={e.level} showHint={false} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <strong className="text-xs">{EVENT_TYPE_LABEL[e.type]}</strong>
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
            <p className="text-muted-foreground">近 30 天无风险拦截事件。</p>
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

      {/* 医生问答（T7）：患者维度追问 */}
      <SectionHeading title="向 Agent 追问该患者" />
      <AskPanel patientId={patient.id} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 通用小组件
// ---------------------------------------------------------------------------

function SectionHeading({ eyebrow, title, chip }: { eyebrow?: string; title: string; chip?: string }) {
  return (
    <div className="flex items-center justify-between pt-2">
      <div>
        {eyebrow && <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>}
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
