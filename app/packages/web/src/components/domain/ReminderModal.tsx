import { Bell, Check, Clock3, Pause, Pill, Volume2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PlanGroup, TaskStatus } from '@/lib/tasks'

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待服用',
  taken: '已服',
  skipped: '已跳过',
  later: '稍后提醒',
}

const STATUS_ICON: Record<TaskStatus, typeof Check> = {
  pending: Clock3,
  taken: Check,
  skipped: Pause,
  later: Clock3,
}

/**
 * 服药提醒弹窗（任务书 T9）：到点提醒，提供 已服 / 稍后 / 跳过 与播报。
 * 记录来自用户操作，不代表系统已医学验证；库存按次扣减（服务端事务）。
 */
export function ReminderModal({
  group,
  open,
  onClose,
  onRequest,
}: {
  group: PlanGroup
  open: boolean
  onClose: () => void
  onRequest: (time: string, status: 'taken' | 'skipped' | 'later') => void
}) {
  const nextPending = group.slots.find((s) => s.status === 'pending')
  const speakText = `服药提醒，${group.drugName}，每次${group.dose.value}${group.dose.unit}，每日${group.frequency}次`

  function speak() {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(speakText)
    u.lang = 'zh-CN'
    u.rate = 0.92
    window.speechSynthesis.speak(u)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Bell className="size-5 text-primary" aria-hidden />
            该服药了
          </DialogTitle>
          <DialogDescription>
            {group.drugName} · {group.specification ?? ''} · 每次 {group.dose.value} {group.dose.unit} · 每日{' '}
            {group.frequency} 次{group.route ? ` · ${group.route}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {group.slots.map((slot) => {
            const Icon = STATUS_ICON[slot.status]
            return (
              <button
                key={slot.time}
                type="button"
                disabled={slot.status !== 'pending'}
                title={STATUS_LABEL[slot.status]}
                onClick={() => onRequest(slot.time, 'taken')}
                className={cn(
                  'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold',
                  slot.status === 'pending'
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-muted text-muted-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {slot.time}
                <span className="font-normal opacity-80">{STATUS_LABEL[slot.status]}</span>
              </button>
            )
          })}
        </div>

        <div className="space-y-2">
          <Button className="min-h-11 w-full" disabled={!nextPending} onClick={() => nextPending && onRequest(nextPending.time, 'taken')}>
            <Check className="size-5" aria-hidden />
            确认已服{nextPending ? `（${nextPending.time}）` : ''}
          </Button>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" className="min-h-11" onClick={speak}>
              <Volume2 className="size-4" aria-hidden />
              播报
            </Button>
            <Button variant="outline" className="min-h-11" disabled={!nextPending} onClick={() => nextPending && onRequest(nextPending.time, 'later')}>
              <Clock3 className="size-4" aria-hidden />
              稍后
            </Button>
            <Button variant="outline" className="min-h-11" disabled={!nextPending} onClick={() => nextPending && onRequest(nextPending.time, 'skipped')}>
              <Pause className="size-4" aria-hidden />
              跳过
            </Button>
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Pill className="size-4 shrink-0" aria-hidden />
          记录来自你的操作，不代表系统已医学验证实际服药；库存按次扣减。
        </p>
      </DialogContent>
    </Dialog>
  )
}
