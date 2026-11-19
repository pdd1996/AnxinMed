import { useEffect, useState } from 'react'
import { CalendarDays, LoaderCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface ExpiryForm {
  /** 有效期（YYYY-MM-DD）；'' = 未录入。 */
  expiry: string
  /** 开封日期（YYYY-MM-DD）；'' = 未录入。 */
  openedAt: string
}

/**
 * 编辑效期弹窗（药箱卡片「编辑效期」入口）。
 *
 * 有效期/开封日期是**用户对照药盒自填**的数据，不是模型输出：
 *   · 只认药盒包装上的具体到期日；说明书里的通用保质期（如「24 个月」）推不出这一盒的到期日，系统不代算；
 *   · 留空 = 未录入（药箱显示「待录入」），可稍后补录；
 *   · 允许填已过期日期（如实记录与纠错），临期/过期判定在读取侧做；
 *   · 录错或换新盒 → 随时回到本弹窗改。
 *
 * 保存失败由 Box 的 PATCH mutation 经 core.unwrap → ApiNotifier（sonner toast）报错，弹窗保持打开可重试。
 */
export function ExpiryDialog({
  open,
  initialExpiry,
  initialOpenedAt,
  busy = false,
  onClose,
  onSave,
}: {
  open: boolean
  /** 当前药品已录入的值；null/undefined → 空（未录入）。 */
  initialExpiry?: string | null
  initialOpenedAt?: string | null
  busy?: boolean
  onClose: () => void
  onSave: (data: ExpiryForm) => void
}) {
  const [expiry, setExpiry] = useState(initialExpiry ?? '')
  const [openedAt, setOpenedAt] = useState(initialOpenedAt ?? '')

  // 每次打开都以该药当前值重置（换药/重开不残留上一次的输入）
  useEffect(() => {
    if (open) {
      setExpiry(initialExpiry ?? '')
      setOpenedAt(initialOpenedAt ?? '')
    }
  }, [open, initialExpiry, initialOpenedAt])

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">编辑有效期与开封日期</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ed-expiry">有效期至</Label>
            <Input
              id="ed-expiry"
              type="date"
              className="min-h-11"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              药盒包装上印的「有效期至 / 失效日期」。已过期的药也可以如实录入，用于临期/过期提示。
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ed-opened">开封日期（可选）</Label>
            <Input
              id="ed-opened"
              type="date"
              className="min-h-11"
              value={openedAt}
              onChange={(e) => setOpenedAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">第一次打开包装的日期；不记得可留空，之后也能补。</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="min-h-11 sm:flex-1" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button className="min-h-11 sm:flex-1" disabled={busy} onClick={() => onSave({ expiry, openedAt })}>
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <CalendarDays className="size-4" aria-hidden />
            )}
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
