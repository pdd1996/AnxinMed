import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface PendingRecord {
  planId: string
  time: string
  status: 'taken' | 'skipped' | 'later'
  drugName: string
}

const ACTION_LABEL: Record<PendingRecord['status'], string> = {
  taken: '已服',
  skipped: '跳过',
  later: '稍后提醒',
}

/**
 * 二次确认拦截（任务书 T9）：服药记录一旦写入不可修改（同 slot 重复 POST 服务端返回 409），
 * 故提交前必须显式确认，防误触。
 */
export function ConfirmRecordDialog({
  pending,
  onClose,
  onConfirm,
}: {
  pending: PendingRecord | null
  onClose: () => void
  onConfirm: (pending: PendingRecord) => void
}) {
  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg">确认记录</DialogTitle>
          <DialogDescription asChild>
            <p className="text-foreground">
              将 <strong>{pending?.drugName}</strong> 在 <strong>{pending?.time}</strong> 记录为{' '}
              <strong>{pending ? ACTION_LABEL[pending.status] : ''}</strong>？
            </p>
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">服药记录写入后不可修改，请确认无误。</p>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11 flex-1" onClick={onClose}>
            取消
          </Button>
          <Button className="min-h-11 flex-1" onClick={() => pending && onConfirm(pending)}>
            确认{pending ? ACTION_LABEL[pending.status] : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
