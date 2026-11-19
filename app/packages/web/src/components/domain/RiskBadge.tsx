import type { RiskEventLevel, RiskLevel } from '@anxin/shared'
import { cn } from '@/lib/utils'
import { RISK_BADGE_META } from './riskMeta'

/**
 * 风险语义徽章（守门 L1–L4，L4 最高；manual-gate 为人工档门禁，非风险分级）。
 * 老年向原则：图标 + 文字并用，不单靠颜色传达风险（技术方案 §8 / §11）；
 * 颜色走设计令牌 --risk-l1..l4（styles/index.css），L1 绿 / L2 蓝 / L3 橙 / L4 红，
 * manual-gate 走中性 muted（药品未经 OCR 确认，仅允许 L0 资料查询，同 AnswerCard 降级样式）。
 * 元信息（label / icon / className）见 riskMeta.ts——与医生端风险事件汇总条共用一份文案。
 */
export function RiskBadge({
  level,
  showHint = true,
  className,
}: {
  level: RiskLevel | RiskEventLevel
  showHint?: boolean
  className?: string
}) {
  const meta = RISK_BADGE_META[level]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold',
        meta.className,
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{meta.label}</span>
      {showHint && <span className="font-normal opacity-85">{meta.hint}</span>}
    </span>
  )
}
