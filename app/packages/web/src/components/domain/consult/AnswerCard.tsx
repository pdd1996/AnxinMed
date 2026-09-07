import { AlertTriangle, ChevronRight, Database, Info, ShieldCheck } from 'lucide-react'
import type { ConsultSections, ConsultStatus, RiskLevel } from '@anxin/shared'
import { RiskBadge } from '@/components/domain/RiskBadge'
import { Card, CardContent } from '@/components/ui/card'
import { SpeakButton } from '@/components/domain/voice/SpeakButton'
import { CitationsList } from './CitationsList'
import type { Citation } from '@anxin/shared'

/**
 * 常规回答卡（M3-T2 · PRD §7.5）——L1/L2/L3/manual-gate/no-source/ai-unavailable 各分支的统一渲染。
 *
 * 结构（照搬 demo/src/pages/Consult.tsx 的 answer-structured 模式）：
 * - 顶部：RiskBadge（语义色+文字）+ status 徽章（中文 label）
 * - 中部：sections 结构化（简明结论 / 需要知道 / 注意风险 / 下一步 / 提示）
 * - 底部：notice（L2 过滤提示 / no-source 兜底 / ai-unavailable 降级）+ l0Notice（manual 档）+ CitationsList
 *
 * ⚠️ L4 走 EmergencyCard（不走本卡）；本卡渲染时 blocked 可能为 true（L3/manual-gate），
 *    此时 sections 为守门固定文案（不是 LLM 生成），前端仍全量渲染（用户需看到拒答原因）。
 *
 * 意图路由 T5：新增 data-answered 分支（药箱数据查询，后端模板直查库，0 LLM）——
 *    status 徽章「数据查询」+ toolUsed 小字徽章（如「来源：药箱清单」）；
 *    citations 为 DB 来源（drugName='我的用药数据'），CitationsList 自然渲染无需特处理。
 */

/** status → 中文 label（老年向：文字说明，不单靠颜色；icon 可选，仅 data-answered 用）。 */
const STATUS_META: Record<
  ConsultStatus,
  { label: string; className: string; icon?: typeof Database }
> = {
  answered: { label: '已回答', className: 'border-risk-l1/30 bg-risk-l1/10 text-risk-l1' },
  limited: { label: '已过滤剂量', className: 'border-risk-l2/30 bg-risk-l2/10 text-risk-l2' },
  refused: { label: '已拒答', className: 'border-risk-l3/35 bg-risk-l3/15 text-risk-l3' },
  emergency: { label: '紧急', className: 'border-risk-l4/35 bg-risk-l4/15 text-risk-l4' },
  'manual-gate': { label: '仅资料查询', className: 'border-muted-foreground/30 bg-muted text-muted-foreground' },
  'no-source': { label: '本地未收录', className: 'border-muted-foreground/30 bg-muted text-muted-foreground' },
  'ai-unavailable': { label: 'AI 降级', className: 'border-muted-foreground/30 bg-muted text-muted-foreground' },
  // 数据查询（意图路由 T5）：非 LLM 生成，用主题色与「已回答」区分；徽章带 Database 图标强化「查库」语义。
  'data-answered': { label: '数据查询', className: 'border-primary/30 bg-primary/10 text-primary', icon: Database },
}

/** toolUsed → 中文徽章名（意图路由 T5；值与后端 intent.ts QueryIntent 四值对齐，未知值不渲染）。 */
const TOOL_LABELS: Record<string, string> = {
  'medication-list': '药箱清单',
  adherence: '依从性统计',
  'expiry-stock': '效期与库存',
  'interaction-check': '相互作用检查',
}

export interface AnswerCardProps {
  riskLevel: RiskLevel
  status: ConsultStatus
  answer: string
  sections: ConsultSections | null
  citations: Citation[]
  notice?: string | null
  l0Notice?: string | null
  blocked?: boolean
  /** 数据查询命中的只读工具名（仅 status='data-answered' 时有值，hc<AppType> 推导自 shared toolUsed）。 */
  toolUsed?: string | null
}

/**
 * 组装中文播报文本（spec §T4.2）：结构化 sections 按「结论→需要知道→注意风险→下一步→提醒」顺序朗读，
 * 否则用一句话 answer；末尾附 notice（如 L2 过滤提示）。去除尾部句号避免叠字。
 */
function buildSpeakText(sections: ConsultSections | null, answer: string, notice?: string | null): string {
  const parts: string[] = []
  if (sections) {
    parts.push(sections.summary)
    if (sections.keyPoints.length > 0) parts.push(`需要知道，${sections.keyPoints.join('；')}`)
    if (sections.risks.length > 0) parts.push(`注意风险，${sections.risks.join('；')}`)
    parts.push(`下一步，${sections.nextAction}`)
    if (sections.warning) parts.push(sections.warning)
  } else if (answer) {
    parts.push(answer)
  }
  if (notice) parts.push(notice)
  return parts
    .filter(Boolean)
    .map((s) => s.replace(/[。.]+$/, '').trim())
    .filter(Boolean)
    .join('。')
}

export function AnswerCard({
  riskLevel,
  status,
  answer,
  sections,
  citations,
  notice,
  l0Notice,
  blocked,
  toolUsed,
}: AnswerCardProps) {
  const statusMeta = STATUS_META[status]
  const StatusIcon = statusMeta.icon
  // toolUsed 小字徽章（仅映射表内的已知工具渲染；老年向：文字说明，不单靠颜色/图标）。
  const toolLabel = toolUsed ? TOOL_LABELS[toolUsed] : undefined

  return (
    // data-testid：E2E（consult-dataquery.spec.ts）按回答卡 scope 断言，避开 DrugSelector 中同名药 chip 的文本重名歧义。
    <Card className={blocked ? 'border-risk-l3/30' : undefined} data-testid="consult-answer-card">
      <CardContent className="space-y-3 p-4">
        {/* 顶部：RiskBadge + status 徽章 + toolUsed 小字徽章 + 播报（M3-T4 §T4.2） */}
        <div className="flex flex-wrap items-center gap-2">
          <RiskBadge level={riskLevel} showHint />
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusMeta.className}`}
          >
            {StatusIcon && <StatusIcon className="size-3.5 shrink-0" aria-hidden />}
            {statusMeta.label}
          </span>
          {toolLabel && (
            <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
              来源：{toolLabel}
            </span>
          )}
          <SpeakButton text={buildSpeakText(sections, answer, notice)} className="ml-auto" />
        </div>

        {/* 中部：sections 结构化（如有）；否则仅 answer 一句话 */}
        {sections ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">简明结论</span>
              <p className="text-sm font-semibold text-foreground">{sections.summary}</p>
            </div>

            {sections.keyPoints.length > 0 && (
              <div className="space-y-1">
                <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Info className="size-3.5" aria-hidden />
                  需要知道
                </h4>
                <ul className="space-y-1 pl-1 text-sm text-foreground">
                  {sections.keyPoints.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sections.risks.length > 0 && (
              <div className="space-y-1">
                <h4 className="flex items-center gap-1.5 text-xs font-medium text-risk-l3">
                  <AlertTriangle className="size-3.5" aria-hidden />
                  注意风险
                </h4>
                <ul className="space-y-1 pl-1 text-sm text-foreground">
                  {sections.risks.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-risk-l3" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5">
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-muted-foreground">下一步</span>
                <p className="text-sm font-semibold text-foreground">{sections.nextAction}</p>
              </div>
            </div>

            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {sections.warning}
            </p>
          </div>
        ) : (
          <p className="text-sm text-foreground">{answer}</p>
        )}

        {/* 底部：notice（L2 过滤 / no-source 兜底 / ai-unavailable 降级） */}
        {notice && (
          <p className="flex items-start gap-1.5 rounded-md border border-risk-l2/30 bg-risk-l2/10 p-2 text-xs text-risk-l2">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {notice}
          </p>
        )}

        {/* 底部：l0Notice（manual 档提示） */}
        {l0Notice && (
          <p className="flex items-start gap-1.5 rounded-md border border-muted-foreground/30 bg-muted p-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {l0Notice}
          </p>
        )}

        {/* 底部：citations 折叠（三件套：药名 + source + version） */}
        <CitationsList citations={citations} />
      </CardContent>
    </Card>
  )
}
