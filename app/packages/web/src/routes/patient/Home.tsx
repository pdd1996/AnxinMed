import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Bell, Camera, Check, ChevronRight, Clock3, Info, PackageCheck, Pause, Pill, Sparkles } from 'lucide-react'
import { client, fetchTodayTasks, unwrap } from '@/api/client'
import { duePendingSlots, groupTasksByPlan, type PlanGroup, type TaskStatus } from '@/lib/tasks'
import { useReminderQueue } from '@/stores/reminderQueue'
import { ReminderModal } from '@/components/domain/ReminderModal'
import { ConfirmRecordDialog, type PendingRecord } from '@/components/domain/ConfirmRecordDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { todayStr } from '@anxin/shared'

type TodayData = Awaited<ReturnType<typeof fetchTodayTasks>>

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

function cycleLabel(group: PlanGroup): string {
  if (group.cycleType === 'open') return '长期'
  if (group.cycleType === 'stock') return '用完为止'
  return `疗程至 ${group.endDate ?? '—'}`
}

/**
 * 今日任务页（任务书 T9，参照 demo Today.tsx）：任务卡 + 已服/稍后/跳过（二次确认）+
 * 提醒弹窗（页面打开期间轮询比对，zustand 队列）+ 乐观更新。数据接 GET /api/tasks/today。
 */
export default function Home() {
  const queryClient = useQueryClient()
  const today = todayStr()
  const [pending, setPending] = useState<PendingRecord | null>(null)
  const [reminderPlanId, setReminderPlanId] = useState<string | null>(null)
  const { queue, enqueue, dequeue } = useReminderQueue()

  const { data } = useQuery({
    queryKey: ['tasks', 'today'],
    queryFn: fetchTodayTasks,
    refetchInterval: 30_000, // 页面打开期间轮询（提醒比对）
  })
  const groups = useMemo(() => groupTasksByPlan(data?.items ?? []), [data])

  // 记录服药：乐观更新 today 缓存；失败回滚（unwrap 已 toast 错误，409=重复操作）。
  const recordMutation = useMutation({
    mutationFn: async (input: { planId: string; time: string; status: 'taken' | 'skipped' | 'later' }) => {
      const res = await client.api.records.$post({
        json: { planId: input.planId, date: today, time: input.time, status: input.status },
      })
      return unwrap(res)
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['tasks', 'today'] })
      const prev = queryClient.getQueryData<TodayData>(['tasks', 'today'])
      queryClient.setQueryData<TodayData>(['tasks', 'today'], (old) => {
        if (!old) return old
        return {
          ...old,
          items: old.items.map((it) =>
            it.planId === input.planId && it.time === input.time ? { ...it, status: input.status } : it,
          ),
        }
      })
      return { prev }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['tasks', 'today'], ctx.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'today'] })
      queryClient.invalidateQueries({ queryKey: ['drugs'] })
    },
  })

  // 提醒轮询比对：到点仍 pending 的计划入队；队首自动弹出提醒。
  useEffect(() => {
    for (const g of groups) {
      if (duePendingSlots(g).length > 0 && !queue.some((q) => q.planId === g.planId)) {
        enqueue({ planId: g.planId, time: duePendingSlots(g)[0].time })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])
  useEffect(() => {
    if (!reminderPlanId && queue.length > 0) setReminderPlanId(queue[0].planId)
  }, [queue, reminderPlanId])

  const reminderGroup = groups.find((g) => g.planId === reminderPlanId) ?? null
  const summary = data?.summary
  const progress = summary?.progress ?? 0

  function requestRecord(group: PlanGroup, time: string, status: 'taken' | 'skipped' | 'later') {
    setPending({ planId: group.planId, time, status, drugName: group.drugName })
  }
  function confirmRecord(p: PendingRecord) {
    recordMutation.mutate({ planId: p.planId, time: p.time, status: p.status })
    setPending(null)
    setReminderPlanId(null)
    dequeue()
  }

  return (
    <div className="space-y-5">
      {/* hero 进度 */}
      <Card className="border-primary/20 bg-primary text-primary-foreground">
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs opacity-80">
              {new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}
            </p>
            <h2 className="mt-1 text-2xl font-bold">
              {!summary || summary.total === 0
                ? '把所有来源的药放进同一个药箱'
                : progress >= 100
                  ? '今天的用药已全部记录'
                  : '按时用药，安心每一天'}
            </h2>
            <p className="mt-1 text-sm opacity-80">所有提醒均来自你亲自确认的计划。</p>
          </div>
          <div className="grid size-24 shrink-0 place-content-center rounded-full border-4 border-primary-foreground/30 text-center">
            <span className="text-2xl font-bold">{progress}%</span>
            <small className="text-[10px] opacity-80">今日完成</small>
          </div>
        </CardContent>
      </Card>

      {/* 任务列表 / 空态 */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
              <PackageCheck className="size-8" aria-hidden />
            </span>
            <h3 className="text-lg font-bold">还没有今日用药任务</h3>
            <p className="text-sm text-muted-foreground">完成录入并建立计划后，这里会出现每日服药任务。</p>
            <Button asChild className="min-h-11">
              <Link to="/intake/rx">
                开始录入 <ChevronRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <Card key={group.planId}>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                    <Pill className="size-6" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-lg font-bold">{group.drugName}</h3>
                      <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                        {cycleLabel(group)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {group.specification ?? ''} · 每次 {group.dose.value} {group.dose.unit} · 每日 {group.frequency} 次
                      {group.route ? ` · ${group.route}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {group.slots.map((slot) => {
                    const Icon = STATUS_ICON[slot.status]
                    const clickable = slot.status === 'pending'
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        disabled={!clickable}
                        title={clickable ? `记录 ${slot.time} 为已服` : STATUS_LABEL[slot.status]}
                        onClick={() => requestRecord(group, slot.time, 'taken')}
                        className={cn(
                          'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold',
                          clickable
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

                <Button variant="outline" className="min-h-11 w-full" onClick={() => setReminderPlanId(group.planId)}>
                  <Bell className="size-4" aria-hidden />
                  处理提醒
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 入口卡片 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button asChild variant="secondary" className="min-h-16 h-auto flex-col items-start gap-1 p-4 text-left">
          <Link to="/intake/rx">
            <span className="flex items-center gap-2 text-base font-bold">
              <Camera className="size-5" aria-hidden /> 拍照录入
            </span>
            <span className="text-xs font-normal opacity-80">拍处方笺一步建档建计划 / 拍药品建档</span>
          </Link>
        </Button>
        <Button asChild variant="secondary" className="min-h-16 h-auto flex-col items-start gap-1 p-4 text-left">
          <Link to="/consult">
            <span className="flex items-center gap-2 text-base font-bold">
              <Sparkles className="size-5" aria-hidden /> 问问 AI
            </span>
            <span className="text-xs font-normal opacity-80">说明书解释 · 药理机制 · 注意事项</span>
          </Link>
        </Button>
      </div>

      <p className="flex items-start gap-2 rounded-xl border bg-card p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        网页提醒说明：仅在页面打开时提醒，关闭页面后不会发送系统通知。漏服不会自动建议补服。
      </p>

      {reminderGroup && (
        <ReminderModal
          group={reminderGroup}
          open={reminderPlanId !== null}
          onClose={() => {
            setReminderPlanId(null)
            dequeue()
          }}
          onRequest={(time, status) => requestRecord(reminderGroup, time, status)}
        />
      )}
      <ConfirmRecordDialog pending={pending} onClose={() => setPending(null)} onConfirm={confirmRecord} />
    </div>
  )
}
