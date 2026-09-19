import { useEffect, useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { CONFIRM_STATUS_META, type ConfirmStatus, type DrugDTOType } from '@anxin/shared'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/**
 * 可搜索选药底部弹层——咨询页「对象药」的切换入口。
 *
 * 取代旧 DrugSelector 的常驻 chip 枚举：咨询页的对象药是「上下文」而非「展示列表」，
 * 页面只常驻一颗当前对象药丸，换药时开本弹层按通用名/商品名搜索选择。
 * 药箱规模到上千种时页面结构不变（枚举在千种规模下不可选，搜索才可以）。
 *
 * 圆点颜色语义沿用原 DrugSelector：transcribed 绿 / ocr_matched 蓝 / manual 灰。
 */

const CS_DOT_CLASS: Record<ConfirmStatus, string> = {
  transcribed: 'bg-risk-l1',
  ocr_matched: 'bg-risk-l2',
  manual: 'bg-muted-foreground',
}

export interface DrugPickerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  drugs: DrugDTOType[]
  selectedId: string | null
  onSelect: (drugId: string) => void
}

export function DrugPickerSheet({ open, onOpenChange, drugs, selectedId, onSelect }: DrugPickerSheetProps) {
  const [keyword, setKeyword] = useState('')
  useEffect(() => {
    if (open) setKeyword('')
  }, [open])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return drugs
    return drugs.filter((d) => `${d.genericName}${d.brandName ?? ''}`.toLowerCase().includes(kw))
  }, [drugs, keyword])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle>选择咨询药品</SheetTitle>
          <SheetDescription>说明书类问题将围绕所选药品回答</SheetDescription>
        </SheetHeader>
        <div className="flex items-center gap-2 rounded-md border border-input px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索药名 / 商品名"
            aria-label="搜索药品"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul className="max-h-[45vh] space-y-1 overflow-y-auto">
          {filtered.map((drug) => {
            const selected = drug.id === selectedId
            return (
              <li key={drug.id}>
                <button
                  type="button"
                  title={CONFIRM_STATUS_META[drug.confirmStatus].label}
                  onClick={() => {
                    onSelect(drug.id)
                    onOpenChange(false)
                  }}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
                    selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                  )}
                >
                  <span
                    className={cn('size-2 shrink-0 rounded-full', CS_DOT_CLASS[drug.confirmStatus])}
                    aria-hidden
                  />
                  <span className="flex-1 truncate font-medium">{drug.genericName}</span>
                  {drug.brandName && (
                    <span className="shrink-0 text-xs text-muted-foreground">{drug.brandName}</span>
                  )}
                  {selected && <Check className="size-4 shrink-0" aria-hidden />}
                </button>
              </li>
            )
          })}
          {filtered.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">没有匹配「{keyword}」的药品</li>
          )}
        </ul>
      </SheetContent>
    </Sheet>
  )
}
