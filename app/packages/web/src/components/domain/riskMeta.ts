/**
 * 风险语义徽章的元信息（中文名 / 提示 / 图标 / 配色）。
 *
 * 独立成文件而不是内联在 RiskBadge.tsx：医生端「近 30 天风险事件」汇总条也要用同一份
 * 等级中文名，抽出后单源维护；同时组件文件只导出组件（react-refresh 的 HMR 约定）。
 * 老年向原则：图标 + 文字并用，不单靠颜色传达风险（技术方案 §8 / §11）。
 */
import type { RiskEventLevel, RiskLevel } from '@anxin/shared'
import { CircleCheckIcon, InfoIcon, LockKeyholeIcon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'

export const RISK_BADGE_META: Record<
  RiskLevel | RiskEventLevel,
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
  'manual-gate': {
    label: '人工档',
    hint: '未经 OCR 确认',
    icon: LockKeyholeIcon,
    className: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  },
}
