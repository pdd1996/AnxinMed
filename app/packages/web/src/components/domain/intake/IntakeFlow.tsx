import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronRight,
  FileText,
  Hand,
  ImagePlus,
  ListChecks,
  LoaderCircle,
  Package,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  SwitchCamera,
  TriangleAlert,
} from 'lucide-react'
import {
  detectImage,
  initialIntakeFlowState,
  intakeDrug,
  intakePrescription,
  QUALITY_HINTS,
  QUALITY_ISSUE_LABEL,
  SAFETY_NOTE,
  STAGE_TEXT,
  transitionIntakeFlow,
  useIntakeSession,
  validateFile,
  type Entry,
  type IntakeDraftSummary,
  type IntakeFlowAction,
  type IntakeFlowCtx,
  type IntakeFlowEvent,
  type IntakeFlowState,
} from '@anxin/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { computeImageStats } from '@/lib/imageStats'
import { cn } from '@/lib/utils'

/** 双入口 tab（PRD §7.2.1 A/B 平级展示）：标签图标固定在此，跳转路径仍由注入的 otherEntryPath 决定。 */
const ENTRY_TABS: { entry: Entry; label: string; icon: typeof FileText }[] = [
  { entry: 'A', label: '拍处方笺', icon: FileText },
  { entry: 'B', label: '拍药品', icon: Package },
]

export interface IntakeCopy {
  entry: Entry
  pageTitle: string
  uploadTitle: string
  uploadHint: string
  otherEntryLabel: string
  otherEntryPath: string
}

/**
 * 录入流程壳（M2-T8 · PRD §7.2.1 / §7.2.6 / §10.1）：上传 → 本地质量预检 → 层检测（可纠正）→ 管线 → 草稿。
 * 两入口共用；文案经 IntakeCopy 注入。上传步以平级 tab 呈现两入口（拍处方笺 / 拍药品），
 * 切换即路由跳转；照片进入流程后 tab 收起，换入口只走纠偏/失败卡的显式动作（层检测不静默改道）。
 * 所有失败分支渲染成可见卡片 + 可行动作，禁止静默吞错。
 *
 * M5-T2 接缝 #8：六步流转的**决策**已抽到 @anxin/core 的 intakeFlow 状态机（纯函数、可单测）；
 * 本组件只做两件事——渲染 state，以及执行状态机给出的动作清单
 * （网络请求、FileReader、canvas 像素统计、navigate、toast、内存会话读写、900ms 阶段定时器）。
 */
export function IntakeFlow({ copy }: { copy: IntakeCopy }) {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<IntakeFlowState>(initialIntakeFlowState)
  // 动作解释器要在异步回调里读到最新状态（而非发起时的闭包值）；状态只经 dispatch 写入，故 ref 与 state 同源。
  const stateRef = useRef(state)

  const stages = STAGE_TEXT[copy.entry]
  const ctx: IntakeFlowCtx = { entry: copy.entry, otherEntryPath: copy.otherEntryPath, stageCount: stages.length }

  /** 执行 core 决策产出的动作（本端副作用；结果再以事件回灌状态机）。 */
  function runActions(actions: IntakeFlowAction[]) {
    for (const action of actions) {
      switch (action.type) {
        case 'toast':
          toast.error(action.message)
          break
        case 'compute_stats':
          void computeImageStats(action.dataUrl).then((stats) =>
            dispatch({ type: 'stats_checked', stats }),
          )
          break
        case 'detect':
          void detectImage(action.dataUrl, action.entry).then((det) => {
            if (!det.ok) {
              dispatch({ type: 'detect_failed', failure: det })
              return
            }
            dispatch({
              type: 'detect_ok',
              dataUrl: action.dataUrl,
              layers: det.data.layers,
              unsupported: det.data.unsupported,
              mismatch: det.data.mismatch,
            })
          })
          break
        case 'intake':
          void (action.entry === 'A' ? intakePrescription(action.dataUrl) : intakeDrug(action.dataUrl)).then(
            (res) => {
              if (!res.ok) {
                dispatch({ type: 'intake_failed', failure: res })
                return
              }
              dispatch({ type: 'intake_ok', dataUrl: action.dataUrl, result: res.data })
            },
          )
          break
        case 'session_set_images':
          useIntakeSession.getState().setSession(action.draftIds, action.dataUrl)
          break
        case 'session_set_pending_image':
          useIntakeSession.getState().setPendingImage(action.pending)
          break
        case 'session_clear_pending_image':
          useIntakeSession.getState().setPendingImage(null)
          break
        case 'navigate':
          navigate(action.path)
          break
      }
    }
  }

  /** 单步迁移：core 决策（纯）→ 落状态 → 执行动作。setState 保持纯净，副作用只在这里同步跑一次。 */
  function dispatch(event: IntakeFlowEvent) {
    const next = transitionIntakeFlow(stateRef.current, event, ctx)
    stateRef.current = next.state
    setState(next.state)
    runActions(next.actions)
  }

  // 上传中阶段文案推进（处理中状态明确，PRD §10.1）；下标归零由状态机负责
  useEffect(() => {
    if (state.step !== 'processing') return
    const timer = window.setInterval(() => dispatch({ type: 'stage_tick' }), 900)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, stages.length])

  /** 层检测纠偏的跨入口交接：对方入口页留下原图时，本页直接重跑（用户不必重新选文件）。 */
  useEffect(() => {
    dispatch({ type: 'handoff', pending: useIntakeSession.getState().pendingImage })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onFile(file: File) {
    const problem = validateFile(file)
    if (problem) {
      dispatch({ type: 'file_rejected', message: problem })
      return
    }
    const reader = new FileReader()
    reader.onload = () => dispatch({ type: 'file_read', dataUrl: String(reader.result) })
    reader.onerror = () => toast.error('读取图片失败，请重试')
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">拍照录入</p>
        <h1 className="text-2xl font-bold">{copy.pageTitle}</h1>
      </header>

      {state.step === 'upload' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {ENTRY_TABS.map((tab) => {
              const active = tab.entry === copy.entry
              return (
                <button
                  key={tab.entry}
                  type="button"
                  aria-current={active || undefined}
                  onClick={active ? undefined : () => dispatch({ type: 'goto_other_entry' })}
                  className={cn(
                    'flex min-h-12 items-center justify-center gap-2 rounded-xl border text-base font-semibold transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground',
                  )}
                >
                  <tab.icon className="size-5" aria-hidden /> {tab.label}
                </button>
              )
            })}
          </div>
          <Card>
            <CardContent className="space-y-4 py-6">
              <button
                type="button"
                className="flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-input bg-muted/40 p-6 hover:border-primary/60"
                onClick={() => fileRef.current?.click()}
              >
                <span className="relative grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <ImagePlus className="size-8" aria-hidden />
                </span>
                <strong className="text-lg">{copy.uploadTitle}</strong>
                <span className="text-sm text-muted-foreground">{copy.uploadHint}</span>
                <span className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                  <Camera className="size-4" aria-hidden /> 拍摄 / 选择照片
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label="上传照片"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void onFile(file)
                  e.target.value = ''
                }}
              />
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-risk-l3" aria-hidden />
                上传即表示你了解图片可能包含个人健康信息。原图只在本次会话的浏览器内存中使用；服务端只取与用药有关的字段，姓名、门诊号这类信息在发送前就被去掉，原文用完即弃、不存图片字节。
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {state.step === 'quality' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TriangleAlert className="size-5 text-risk-l3" aria-hidden />
              照片质量可能影响识别
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2">
              {state.issues.map((issue) => (
                <li key={issue} className="flex items-start gap-2 rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-3 text-sm text-risk-l3">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <strong className="mr-1">{QUALITY_ISSUE_LABEL[issue]}：</strong>
                    {QUALITY_HINTS[issue]}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              这是浏览器本地的拍照建议（不上传、不做识别判断）。质量差时识别会降级为人工补，不会编造。
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="min-h-11 flex-1" onClick={() => dispatch({ type: 'retake' })}>
                <RotateCcw className="size-4" aria-hidden /> 重拍 / 换一张
              </Button>
              <Button className="min-h-11 flex-1" onClick={() => dispatch({ type: 'retry' })}>
                <Camera className="size-4" aria-hidden /> 仍要上传
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {state.step === 'processing' && (
        <Card>
          <CardContent className="space-y-4 py-6">
            {state.image ? (
              <div className="relative overflow-hidden rounded-lg border">
                <img src={state.image} alt="待识别图片" className="max-h-72 w-full object-contain" />
                <span className="scanline absolute inset-x-0 h-0.5 bg-primary/70" aria-hidden />
              </div>
            ) : (
              <p className="grid place-items-center gap-2 rounded-lg border bg-muted/40 p-6 text-sm text-muted-foreground">
                <ScanLine className="size-6" aria-hidden /> 正在准备图片…
              </p>
            )}
            <p className="flex items-center gap-2 text-lg font-bold">
              <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden /> 正在识别（{copy.entry === 'A' ? '处方笺' : '药品'}）
            </p>
            <ol className="space-y-1.5">
              {stages.map((stage, i) => (
                <li
                  key={stage}
                  className={cn(
                    'flex items-center gap-2 text-sm',
                    i < state.stageIdx ? 'text-muted-foreground' : i === state.stageIdx ? 'font-semibold' : 'text-muted-foreground/60',
                  )}
                >
                  {i < state.stageIdx ? (
                    <Check className="size-4 shrink-0 text-risk-l1" aria-hidden />
                  ) : i === state.stageIdx ? (
                    <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
                  ) : (
                    <span className="size-4 shrink-0 rounded-full border" aria-hidden />
                  )}
                  {stage}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {state.step === 'mismatch' && state.mismatch && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldAlert className="size-5 text-risk-l3" aria-hidden />
              检测结果与所选入口不符
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {state.handoffNote && <p className="text-sm text-muted-foreground">{state.handoffNote}</p>}
            <p className="text-sm">{state.mismatch.suggestion}</p>
            <p className="flex flex-wrap gap-2">
              {state.mismatch.detected.map((layer) => (
                <span key={layer} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                  {layer}
                </span>
              ))}
            </p>
            <p className="text-xs text-muted-foreground">
              系统只核对照片与所选入口是否一致，不会自己换路径。服务端也会拦，按当前入口继续通常仍会被拒绝。
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="min-h-11 flex-1" onClick={() => dispatch({ type: 'switch_entry' })}>
                <SwitchCamera className="size-4" aria-hidden /> 切换到「{copy.otherEntryLabel}」重跑
              </Button>
              <Button
                variant="outline"
                className="min-h-11 flex-1"
                onClick={() => dispatch({ type: 'retry' })}
              >
                检测错了 · 按当前入口重试
              </Button>
              <Button variant="ghost" className="min-h-11 flex-1" onClick={() => dispatch({ type: 'retake' })}>
                <RotateCcw className="size-4" aria-hidden /> 重新上传
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {state.step === 'failure' && state.feedback && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="size-5 text-risk-l4" aria-hidden />
              {state.feedback.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{state.feedback.body}</p>
            {state.feedback.detected.length > 0 && (
              <p className="flex flex-wrap gap-2">
                {state.feedback.detected.map((layer) => (
                  <span key={layer} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                    {layer}
                  </span>
                ))}
              </p>
            )}
            <ul className="space-y-1 text-sm text-muted-foreground">
              {state.feedback.hints.map((hint) => (
                <li key={hint} className="flex items-start gap-2">
                  <ChevronRight className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {hint}
                </li>
              ))}
            </ul>
            <p className="flex items-start gap-2 rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-3 text-sm text-risk-l3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {SAFETY_NOTE}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="min-h-11 flex-1" onClick={() => dispatch({ type: 'retake' })}>
                <RotateCcw className="size-4" aria-hidden /> 重新上传
              </Button>
              {state.feedback.allowManual && (
                <Button variant="outline" className="min-h-11 flex-1" onClick={() => dispatch({ type: 'goto_manual' })}>
                  <Hand className="size-4" aria-hidden /> 手动建档（不经识别）
                </Button>
              )}
              {state.feedback.allowSwitch && (
                <Button variant="ghost" className="min-h-11 flex-1" onClick={() => dispatch({ type: 'goto_other_entry' })}>
                  <SwitchCamera className="size-4" aria-hidden /> 换到「{copy.otherEntryLabel}」
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {state.step === 'drafts' && state.result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListChecks className="size-5 text-primary" aria-hidden />
              识别完成：{state.result.drafts.length} 份草稿待确认
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              一张处方笺含多个药品时拆成多份「档案 + 计划」草稿；确认页要<strong>一份一份</strong>人工核对。
            </p>
            <ul className="space-y-2">
              {state.result.drafts.map((draft, i) => (
                <li key={draft.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                    {draft.type === 'prescription' ? <FileText className="size-4" aria-hidden /> : <Package className="size-4" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-base">{draft.drugName || `条目 ${i + 1}`}</strong>
                    <span className="flex flex-wrap gap-1.5">
                      <DraftChips draft={draft} />
                    </span>
                  </span>
                  <Button className="min-h-10 shrink-0" onClick={() => dispatch({ type: 'open_draft', draftId: draft.id })}>
                    去确认 <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="ghost" className="min-h-10" onClick={() => dispatch({ type: 'retake' })}>
              <RotateCcw className="size-4" aria-hidden /> 再传一张
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** 草稿概要徽章：冲突 / 需人工补 / 标签不抄录 / 降级 —— 让用户在列表页就知道每份草稿要核对什么。 */
function DraftChips({ draft }: { draft: IntakeDraftSummary }) {
  const chips: { text: string; tone: string }[] = []
  if (draft.matchStatus === 'conflict' || draft.matchStatus === 'ambiguous') {
    chips.push({ text: '冲突待核对', tone: 'border-risk-l3/40 bg-risk-l3/10 text-risk-l3' })
  }
  if (draft.needsManual > 0) {
    chips.push({ text: `${draft.needsManual} 项需人工补`, tone: 'border-risk-l3/40 bg-risk-l3/10 text-risk-l3' })
  }
  if (draft.labelNotice) {
    chips.push({ text: '标签用法不抄录', tone: 'border-risk-l2/40 bg-risk-l2/10 text-risk-l2' })
  }
  if (draft.degraded) {
    chips.push({ text: `识别降级 ${draft.degraded.code}`, tone: 'border-risk-l4/40 bg-risk-l4/10 text-risk-l4' })
  }
  if (chips.length === 0) chips.push({ text: '待确认', tone: 'border-input bg-muted text-muted-foreground' })
  return (
    <>
      {chips.map((chip) => (
        <span key={chip.text} className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', chip.tone)}>
          {chip.text}
        </span>
      ))}
    </>
  )
}
