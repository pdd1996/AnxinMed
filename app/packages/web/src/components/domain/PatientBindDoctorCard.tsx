import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Stethoscope, UserRoundX } from 'lucide-react'
import {
  fetchMyDoctors,
  redeemBindCode,
  toUserMessage,
  unbindDoctor,
  type BoundDoctorDto,
} from '@anxin/core'
import { BIND_CODE_LENGTH } from '@anxin/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** ISO → 本地日期（绑定时间展示；非法值返回空串，不抛错）。 */
function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN')
}

/**
 * 患者端「我的医生」卡片（specs/25 · 演示最小闭环）。
 *
 * - 输入医生给的 6 位绑定码 → 核销 → 建立授权关系；
 * - 展示已绑定医生；可解绑（两步确认，防误触）；
 * - 仅 password 模式（真实账号）渲染：demo 模式固定注入 p-001，没有真实的医患授权语义。
 */
export function PatientBindDoctorCard() {
  const queryClient = useQueryClient()
  const doctorsQuery = useQuery({ queryKey: ['bindings', 'doctors'], queryFn: fetchMyDoctors })

  const [code, setCode] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [pendingUnbindId, setPendingUnbindId] = useState<string | null>(null)

  const redeemMutation = useMutation({
    mutationFn: (value: string) => redeemBindCode(value),
    onSuccess: (doctor) => {
      setCode('')
      setFeedback({
        kind: 'success',
        text: `绑定成功：${doctor.name ?? '医生'}。医生现在可以看到你的用药情况了。`,
      })
      void queryClient.invalidateQueries({ queryKey: ['bindings', 'doctors'] })
    },
    onError: (error) => {
      setFeedback({ kind: 'error', text: toUserMessage(error, '绑定失败，请核对绑定码后重试') })
    },
  })

  const unbindMutation = useMutation({
    mutationFn: (doctorId: string) => unbindDoctor(doctorId),
    onSuccess: () => {
      setPendingUnbindId(null)
      setFeedback({ kind: 'success', text: '已解除绑定，医生将不再看到你的用药情况。' })
      void queryClient.invalidateQueries({ queryKey: ['bindings', 'doctors'] })
    },
    onError: (error) => {
      setPendingUnbindId(null)
      setFeedback({ kind: 'error', text: toUserMessage(error, '解绑失败，请稍后重试') })
    },
  })

  const doctors: BoundDoctorDto[] = doctorsQuery.data ?? []
  const canSubmit = code.trim().length === BIND_CODE_LENGTH && !redeemMutation.isPending

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
        <Stethoscope className="size-5 text-primary" aria-hidden />
        我的医生
      </h2>
      <p className="text-sm text-muted-foreground">
        绑定后，医生可以在医生端看到你的用药与打卡情况。你可以随时解绑。
      </p>

      <Card>
        <CardContent className="space-y-4 p-4">
          {doctorsQuery.isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> 正在加载…
            </p>
          )}

          {!doctorsQuery.isLoading && doctors.length === 0 && (
            <p className="text-sm text-muted-foreground">还没有绑定医生。请向你的医生索取 6 位绑定码。</p>
          )}

          {doctors.length > 0 && (
            <ul className="space-y-2">
              {doctors.map((doctor) => (
                <li
                  key={doctor.id}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{doctor.name ?? '未命名医生'}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(doctor.boundAt)} 绑定
                    </span>
                  </span>
                  {pendingUnbindId === doctor.id ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="min-h-10"
                        onClick={() => unbindMutation.mutate(doctor.id)}
                        disabled={unbindMutation.isPending}
                      >
                        确认解绑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-10"
                        onClick={() => setPendingUnbindId(null)}
                      >
                        取消
                      </Button>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-10 shrink-0"
                      onClick={() => setPendingUnbindId(doctor.id)}
                    >
                      <UserRoundX className="size-4" aria-hidden />
                      解绑
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form
            className="space-y-2 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (canSubmit) redeemMutation.mutate(code.trim())
            }}
          >
            <Label htmlFor="bind-doctor-code">输入绑定码</Label>
            <p className="text-xs text-muted-foreground">医生会给你 6 位数字绑定码，输入后即可绑定。</p>
            <div className="flex gap-2">
              <Input
                id="bind-doctor-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={BIND_CODE_LENGTH}
                placeholder={`${BIND_CODE_LENGTH} 位数字`}
                className="min-h-11 font-mono text-lg tracking-[0.25em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, BIND_CODE_LENGTH))}
              />
              <Button type="submit" className="min-h-11 shrink-0" disabled={!canSubmit}>
                {redeemMutation.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : '绑定'}
              </Button>
            </div>
          </form>

          {feedback && (
            <p
              role={feedback.kind === 'error' ? 'alert' : 'status'}
              className={
                feedback.kind === 'error'
                  ? 'rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive'
                  : 'rounded-md bg-primary/10 px-3 py-2 text-sm text-primary'
              }
            >
              {feedback.text}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
