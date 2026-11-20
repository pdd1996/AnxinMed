import { AlertTriangle, ChevronRight, Info, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import type { ConsultClarifyOption, ConsultSections, ConsultStatus, RiskLevel } from '@anxin/shared'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Citation } from '@anxin/shared'

/**
 * 常规回答卡（M3-T2 · PRD §7.5）——L1/L2/L3/manual-gate/no-source/ai-unavailable 各分支的统一渲染。
 *
 * 结构（照搬 demo/src/pages/Consult.tsx 的 answer-structured 模式）：
 * - 中部：sections 结构化（简明结论 / 需要知道 / 注意风险 / 下一步 / 提示）
 * - 底部：notice（L2 过滤提示 / no-source 兜底 / ai-unavailable 降级）+ l0Notice（manual 档）+ CitationsList
 *
 * 风险等级 / 状态 / 来源徽章按产品新口径从患者界面移除（仅保留正文与 citations）。
 *
 * ⚠️ L4 走 EmergencyCard（不走本卡）；本卡渲染时 blocked 可能为 true（L3/manual-gate），
 *    此时 sections 为守门固定文案（不是 LLM 生成），前端仍全量渲染（用户需看到拒答原因）。
 *
 * 意图路由 T5：data-answered 分支（药箱数据查询，后端模板直查库，0 LLM）——
 *    citations 为 DB 来源（drugName='我的用药数据'），CitationsList 自然渲染无需特处理。
 */

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
  /** 对象澄清选项（仅 status='clarify' 时非空，M13-P1）：点选后由页面带 drugId 重发原问题。 */
  clarifyOptions?: ConsultClarifyOption[] | null
  onPickDrug?: (drugId: string) => void
  /** 说明书分段落页入口（2026-11-20）：有值时渲染「查看完整说明书」链接。 */
  leafletHref?: string | null
}

/**
 * 组装中文播报文本（spec §T4.2）：结构化 sections 按「结论→需要知道→注意风险→下一步→提醒」顺序朗读，
 * 否则用一句话 answer；末尾附 notice（如 L2 过滤提示）。去除尾部句号避免叠字。
 *
 * 导出供咨询页头部播放入口复用（2026-09-21 UI 改版：播放入口从卡内移到页头部，播最新一条回答）。
 */
export function buildSpeakText(sections: ConsultSections | null, answer: string, notice?: string | null): string {
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
  status,
  answer,
  sections,
  notice,
  l0Notice,
  citations,
  blocked,
  clarifyOptions,
  onPickDrug,
  leafletHref,
}: AnswerCardProps) {
  // L0 资料查询（manual 档 / 说明书未核验）：原文摘录，不是个性化回答——
  // 顶部先交代「未核验 + 身份/来源」，再用短摘要渲染；完整原文去「查看完整说明书」分段页。
  const isL0 = Boolean(l0Notice)
  // 只有 manual-gate（L0 原文卡）用「说明书原文」语义标签；可用性回答仍是普通小结。
  const isRawLeaflet = isL0 && status === 'manual-gate'
  const source = citations[0]
  const reviewText =
    source?.reviewStatus === 'reviewed'
      ? '已人工核验'
      : source?.reviewStatus
        ? '未人工核验'
        : null
  const identityLine = source
    ? `${[source.drugName, source.specification].filter(Boolean).join(' · ')} · ${source.source}（版本 ${source.version}）`
    : null
  const metaLine = [
    source?.approvalNumbers?.length ? `批准文号：${source.approvalNumbers.join('、')}` : null,
    reviewText ? `核验状态：${reviewText}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    // data-testid：E2E（consult-dataquery.spec.ts）按回答卡 scope 断言，避开 DrugSelector 中同名药 chip 的文本重名歧义。
    <Card className={blocked ? 'border-risk-l3/30' : undefined} data-testid="consult-answer-card">
      <CardContent className="space-y-3 p-4">
        {isL0 && (
          <div className="space-y-1 rounded-md border border-risk-l2/30 bg-risk-l2/10 p-2.5">
            <p className="flex items-start gap-1.5 text-xs font-medium text-risk-l2">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {l0Notice}
            </p>
            {identityLine && <p className="pl-5 text-xs text-muted-foreground">{identityLine}</p>}
            {metaLine && <p className="pl-5 text-xs text-muted-foreground">{metaLine}</p>}
          </div>
        )}

        {/* 中部：sections 结构化（如有）；否则仅 answer 一句话 */}
        {sections ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                {isRawLeaflet ? '说明书原文' : '简明结论'}
              </span>
              <p className="text-sm font-semibold text-foreground">{sections.summary}</p>
            </div>

            {sections.keyPoints.length > 0 && (
              <div className="space-y-1">
                <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Info className="size-3.5" aria-hidden />
                  {isRawLeaflet ? '注意事项' : '需要知道'}
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

            {/* M11-T2：提示卡「短摘要 + 展开原文」——keyPoints 只放级别/药名/来源，逐字原文收进可展开区 */}
            {sections.details && sections.details.length > 0 && (
              <details className="rounded-md border border-border bg-muted/20 p-2.5">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  展开原文（{sections.details.length} 条）
                </summary>
                <ul className="mt-2 space-y-2 pl-1 text-sm text-foreground">
                  {sections.details.map((d) => (
                    <li key={`${d.title}-${d.body}`}>
                      <p className="font-medium">{d.title}</p>
                      <p className="mt-0.5 text-muted-foreground">{d.body}</p>
                      {d.source && <p className="mt-0.5 text-xs text-muted-foreground">来源：{d.source}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {sections.risks.length > 0 && (
              <div className="space-y-1">
                <h4 className="flex items-center gap-1.5 text-xs font-medium text-risk-l3">
                  <AlertTriangle className="size-3.5" aria-hidden />
                  {isRawLeaflet ? '禁忌' : '注意风险'}
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

        {/* 说明书查看入口（2026-11-20）：可用性回答 / L0 原文卡 → 分段落页 */}
        {leafletHref && (
          <Link
            to={leafletHref}
            className="flex min-h-11 items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            查看完整说明书
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        )}

        {/* 底部：notice（L2 过滤 / no-source 兜底 / ai-unavailable 降级） */}
        {notice && (
          <p className="flex items-start gap-1.5 rounded-md border border-risk-l2/30 bg-risk-l2/10 p-2 text-xs text-risk-l2">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {notice}
          </p>
        )}

        {/* 对象澄清（M13-P1）：药名点选 ≥44px，点选后由页面带 drugId 重发原问题 */}
        {clarifyOptions && clarifyOptions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">选择一种药继续：</p>
            <div className="flex flex-wrap gap-2">
              {clarifyOptions.map((option) => (
                <Button
                  key={option.drugId}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 whitespace-normal border-primary/30 text-xs text-primary"
                  onClick={() => onPickDrug?.(option.drugId)}
                >
                  {option.drugName}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
