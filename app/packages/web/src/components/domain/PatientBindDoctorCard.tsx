import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus, UserRoundX } from 'lucide-react'
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
 * - 未绑定医生：卡片就是绑定入口（直接给输入框，不额外放空态说明）；
 * - 已绑定医生：卡片主体是「已绑定列表 + 解绑（两步确认，防误触）」；绑定码输入默认收起，
 *   收进「绑定其他医生」按钮——查看授权状态与再绑一位医生不是同一件事，常驻输入框会让
 *   「我已经绑好了，为什么还让我输码」产生误解（后台允许一个患者授权多位医生，如转诊）。
 * - 仅 password 模式（真实账号）渲染：demo 模式固定注入 p-001，没有真实的医患授权语义。
 *
 * 挂载位置：卡片现在挂在 `/my-doctor` 独立页（患者从「我的 → 绑定医生」进入），
 * 设置页已移除——绑定不是设置项，埋在设置页底部老年患者找不到。
 * 版式约定：页头标题与说明由页面提供（避免 `/my-doctor` 页 h1 与卡片 h2 重复），卡片只承载内容。
 */
export function PatientBindDoctorCard() {
  const queryClient = useQueryClient()
  const doctorsQuery = useQuery({ queryKey: ['bindings', 'doctors'], queryFn: fetchMyDoctors })

  const [code, setCode] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [pendingUnbindId, setPendingUnbindId] = useState<string | null>(null)
  const [bindFormOpen, setBindFormOpen] = useState(false)

  const redeemMutation = useMutation({
    mutationFn: (value: string) => redeemBindCode(value),
    onSuccess: (doctor) => {
      setCode('')
      setBindFormOpen(false)
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
  const isLoading = doctorsQuery.isLoading
  const hasDoctors = doctors.length > 0
  // 未绑定时绑定是页面上唯一要做的事，直接给输入框；已绑定时默认收起，点「绑定其他医生」再展开。
  const showBindForm = !isLoading && (!hasDoctors || bindFormOpen)

  return (
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4 p-4">
          {isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> 正在加载…
            </p>
          )}

          {hasDoctors && (
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

          {!isLoading && hasDoctors && !bindFormOpen && (
            <Button
              variant="outline"
              className="min-h-11 w-full"
              onClick={() => {
                setFeedback(null)
                setBindFormOpen(true)
              }}
            >
              <Plus className="size-4" aria-hidden />
              绑定其他医生
            </Button>
          )}

          {showBindForm && (
            <form
              className={hasDoctors ? 'space-y-2 border-t border-border pt-4' : 'space-y-2'}
              onSubmit={(e) => {
                e.preventDefault()
                if (canSubmit) redeemMutation.mutate(code.trim())
              }}
            >
              <Label htmlFor="bind-doctor-code">输入绑定码</Label>
              <div className="flex gap-2">
                <Input
                  id="bind-doctor-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={BIND_CODE_LENGTH}
                  className="min-h-11 font-mono text-lg tracking-[0.25em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, BIND_CODE_LENGTH))}
                />
                <Button type="submit" className="min-h-11 shrink-0" disabled={!canSubmit}>
                  {redeemMutation.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : '绑定'}
                </Button>
              </div>
              {hasDoctors && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-10 px-0 text-muted-foreground"
                  onClick={() => {
                    setBindFormOpen(false)
                    setCode('')
                    setFeedback(null)
                  }}
                >
                  取消
                </Button>
              )}
            </form>
          )}

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
