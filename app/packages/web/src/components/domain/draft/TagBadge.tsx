import { TAG_META, type TagKind } from '@anxin/shared'
import { cn } from '@/lib/utils'

/**
 * 四类标注徽章（PRD §7.2.4：抄录 / 辅助 / 推算 / 默认，+ 用户自填）。
 * 老年向：颜色之外恒带中文文字，title 给完整语义（不单靠颜色传达信任级别）。
 */
const TONE: Record<TagKind, string> = {
  transcribed: 'border-risk-l2/35 bg-risk-l2/10 text-risk-l2',
  assist: 'border-accent-foreground/25 bg-accent text-accent-foreground',
  derived: 'border-risk-l1/35 bg-risk-l1/10 text-risk-l1',
  default: 'border-input bg-muted text-muted-foreground',
  user: 'border-primary/40 bg-primary/10 text-primary',
}

export function TagBadge({ kind, className }: { kind?: TagKind | null; className?: string }) {
  if (!kind) return null
  const meta = TAG_META[kind]
  return (
    <span
      title={meta.hint}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
        TONE[kind],
        className,
      )}
    >
      {meta.label}
    </span>
  )
}
