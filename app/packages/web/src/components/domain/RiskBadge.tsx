import type { RiskLevel } from '@anxin/shared'
import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 风险语义徽章（守门 L1–L4，L4 最高）。
 * 老年向原则：图标 + 文字并用，不单靠颜色传达风险（技术方案 §8 / §11）；
 * 颜色走设计令牌 --risk-l1..l4（styles/index.css），L1 绿 / L2 蓝 / L3 橙 / L4 红。
 */
const RISK_META: Record<
  RiskLevel,
  { label: string; hint: string; icon: typeof InfoIcon; className: string }
> = {
  L1: {
    label: '低风险',
    hint: '可参考说明书',
    icon: CircleCheckIcon,
    className: 'border-risk-l1/30 bg-risk-l1/10 text-risk-l1',
  },
  L2: {
    label: '提示',
    hint: '建议咨询药师',
    icon: InfoIcon,
    className: 'border-risk-l2/30 bg-risk-l2/10 text-risk-l2',
  },
  L3: {
    label: '注意',
    hint: '建议咨询医生',
    icon: TriangleAlertIcon,
    className: 'border-risk-l3/35 bg-risk-l3/15 text-risk-l3',
  },
  L4: {
    label: '高危',
    hint: '请立即就医',
    icon: OctagonXIcon,
    className: 'border-risk-l4/35 bg-risk-l4/15 text-risk-l4',
  },
}

export function RiskBadge({
  level,
  showHint = true,
  className,
}: {
  level: RiskLevel
  showHint?: boolean
  className?: string
}) {
  const meta = RISK_META[level]
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
