import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { KeyRound, LoaderCircle, RefreshCw } from 'lucide-react'
import { createDoctorBindCode, toUserMessage, type DoctorBindCodeDto } from '@anxin/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * 医生端「邀请患者绑定」卡片（specs/25 · 演示最小闭环）。
 *
 * - 点「生成绑定码」→ POST /api/doctor/bind-code（旧未使用码自动作废）；
 * - 展示 6 位数字 + 剩余有效时间倒计时；
 * - 绑定码一次性、10 分钟有效；不写入任何患者数据，只建立授权关系。
 */
export function DoctorBindCodeCard() {
  const [bindCode, setBindCode] = useState<DoctorBindCodeDto | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const mutation = useMutation({
    mutationFn: createDoctorBindCode,
    onSuccess: (data) => {
      setBindCode(data)
      setNow(Date.now())
    },
  })

  // 倒计时：仅在有码时每秒刷新；卸载/换码时清理，避免离开页面后 setState。
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

  return (
    <Card className="border-primary/25 bg-primary/5">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <KeyRound className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-bold">邀请患者绑定</p>
            <p className="mt-1 text-sm text-muted-foreground">
              生成 6 位绑定码，让患者在患者端「我的 → 我的医生」输入。绑定码 10 分钟内有效、仅可核销一次。
            </p>
          </div>
        </div>

        {bindCode && (
          <div className="rounded-xl border border-primary/30 bg-card px-4 py-3 text-center">
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

        <Button
          className="min-h-11 w-full"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
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
      </CardContent>
    </Card>
  )
}
