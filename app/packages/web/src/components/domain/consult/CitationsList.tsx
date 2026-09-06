import { useState } from 'react'
import { ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react'
import type { Citation } from '@anxin/shared'
import { cn } from '@/lib/utils'

/**
 * citations 折叠展示（M3-T2 · PRD §7.5）——引用三件套（药名 + source + version）。
 *
 * 老年向原则：默认收起（仅显示"来源 N 条"），点击展开看完整三件套；
 * unverified=true 时渲染"未经本库核实"徽章（网络检索兜底，PRD §7.5 医疗搜索默认关）。
 *
 * ⚠️ citations 数据从后端透传到 UI 无丢失（spec §T2 完成标准）：本组件不做任何过滤/裁剪，
 *    按数组顺序全量渲染；空数组时返回 null（不占空间）。
 */
export function CitationsList({ citations, className }: { citations: Citation[]; className?: string }) {
  const [open, setOpen] = useState(false)

  if (!citations || citations.length === 0) return null

  return (
    <div className={cn('mt-3 border-t border-border pt-2', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          来源 <strong className="text-foreground">{citations.length}</strong> 条
        </span>
        {open ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
      </button>

      {open && (
        <ul className="mt-2 space-y-2">
          {citations.map((c, idx) => (
            <li
              key={`${c.drugName}-${c.source}-${c.version}-${idx}`}
              className="rounded-md border border-border bg-muted/30 p-2.5 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <strong className="font-semibold text-foreground">{c.drugName}</strong>
                {c.unverified && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-risk-l3/35 bg-risk-l3/15 px-2 py-0.5 text-xs font-semibold text-risk-l3">
                    <ShieldAlert className="size-3" aria-hidden />
                    未经本库核实
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground/80">来源：</span>
                  {c.source}
                </p>
                <p>
                  <span className="font-medium text-foreground/80">版本：</span>
                  {c.version}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
