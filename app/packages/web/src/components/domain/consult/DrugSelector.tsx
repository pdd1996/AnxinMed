import { CONFIRM_STATUS_META, type ConfirmStatus, type DrugDTOType } from '@anxin/shared'
import { cn } from '@/lib/utils'

/**
 * 药品选择器（M3-T2 · spec §T2.1）——围绕已确认药品提问。
 *
 * 老年向原则：
 * - chip 列表（大点击区域，min-h-11）；
 * - 每个 chip 显示 genericName + confirmStatus 小圆点（颜色语义：transcribed 绿 / ocr_matched 蓝 / manual 灰）；
 * - 选中态 border 高亮 + 背景色；
 * - 空列表时返回 null（Consult 页面渲染"请先确认药品"引导）。
 *
 * ⚠️ 本组件为纯选择器（受控）；manual 档提示由 Consult 页面渲染（需结合当前选中药的完整信息）。
 */

/** confirmStatus → 小圆点颜色类（与 CONFIRM_STATUS_META 语义对齐）。 */
const CS_DOT_CLASS: Record<ConfirmStatus, string> = {
  transcribed: 'bg-risk-l1',
  ocr_matched: 'bg-risk-l2',
  manual: 'bg-muted-foreground',
}

export interface DrugSelectorProps {
  drugs: DrugDTOType[]
  selectedId: string | null
  onSelect: (drugId: string) => void
  className?: string
}

export function DrugSelector({ drugs, selectedId, onSelect, className }: DrugSelectorProps) {
  if (drugs.length === 0) return null

  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="radiogroup" aria-label="选择咨询药品">
      {drugs.map((drug) => {
        const selected = drug.id === selectedId
        const meta = CONFIRM_STATUS_META[drug.confirmStatus]
        return (
          <button
            key={drug.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(drug.id)}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
              selected
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
            title={meta.label}
          >
            <span
              className={cn('size-2 shrink-0 rounded-full', CS_DOT_CLASS[drug.confirmStatus])}
              aria-hidden
            />
            <span>{drug.genericName}</span>
          </button>
        )
      })}
    </div>
  )
}
