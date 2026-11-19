import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { KeyRound, LoaderCircle, RefreshCw } from 'lucide-react'
import { createDoctorBindCode, toUserMessage, type DoctorBindCodeDto } from '@anxin/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/**
 * 医生端「邀请患者绑定」入口（specs/25）。
 *
 * 从页面内嵌大卡片改为**顶栏小按钮 + 弹窗**：
 * - 队列页的主体是患者数据，绑定只是低频动作，不应占据首屏（用户反馈「患者队列变成了绑定码」）；
 * - 打开弹窗才生成/展示一次性绑定码（10 分钟、仅可核销一次）；
 * - 关闭弹窗即清空本地码状态，下次重新生成。
 */
export function DoctorBindDialog() {
  const [open, setOpen] = useState(false)
  const [bindCode, setBindCode] = useState<DoctorBindCodeDto | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const mutation = useMutation({
    mutationFn: createDoctorBindCode,
    onSuccess: (data) => {
      setBindCode(data)
      setNow(Date.now())
    },
  })

  // 倒计时：仅在有码时每秒刷新；关闭弹窗/卸载时清理。
  useEffect(() => {
    if (!bindCode) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [bindCode])

  const remainingSec = bindCode
    ? Math.max(0, Math.ceil((new Date(bindCode.expiresAt).getTime() - now) / 1000))
    : 0
  const mmss = `${String(Math.floor(remainingSec / 60)).padStart(2, '0')}:${String(remainingSec % 60).padStart(2, '0')}`
  const expired = bindCode !== null && remainingSec <= 0
  const errorText = mutation.error ? toUserMessage(mutation.error, '绑定码生成失败，请重试') : ''

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // 关闭即重置：避免下次打开看到上一次的旧码/旧错误。
      setBindCode(null)
      mutation.reset()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-10 shrink-0 whitespace-nowrap">
          <KeyRound className="size-4" aria-hidden />
          邀请患者绑定
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">邀请患者绑定</DialogTitle>
        </DialogHeader>

        {bindCode && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-4 text-center">
            <p className="text-xs font-medium text-muted-foreground">绑定码</p>
            <p className="mt-1 font-mono text-3xl font-bold tracking-[0.35em] text-primary" aria-live="polite">
              {bindCode.code}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {expired ? '已过期，请重新生成' : `剩余有效时间 ${mmss}`}
            </p>
          </div>
        )}

        {errorText && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorText}
          </p>
        )}

        <Button className="min-h-11 w-full" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> 正在生成…
            </>
          ) : bindCode ? (
            <>
              <RefreshCw className="size-4" aria-hidden /> 重新生成绑定码
            </>
          ) : (
            '生成绑定码'
          )}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
