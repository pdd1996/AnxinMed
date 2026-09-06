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
import { detectImage, intakeDrug, intakePrescription } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useIntakeSession } from '@/stores/intakeSession'
import {
  assessQuality,
  computeImageStats,
  mapIntakeFailure,
  QUALITY_HINTS,
  QUALITY_ISSUE_LABEL,
  RETAKE_CHECKLIST,
  SAFETY_NOTE,
  STAGE_TEXT,
  validateFile,
  type Entry,
  type IntakeFeedback,
  type QualityIssue,
} from '@/lib/intake'
import { cn } from '@/lib/utils'

type IntakeOk = Extract<Awaited<ReturnType<typeof intakePrescription>>, { ok: true }>['data']
type DraftSummary = IntakeOk['drafts'][number]
type Failure = Extract<Awaited<ReturnType<typeof intakePrescription>>, { ok: false }>

export interface IntakeCopy {
  entry: Entry
  pageTitle: string
  pageLead: string
  uploadTitle: string
  uploadHint: string
  guidePoints: string[]
  otherEntryLabel: string
  otherEntryPath: string
}

type Step = 'upload' | 'quality' | 'processing' | 'mismatch' | 'failure' | 'drafts'

/**
 * 录入流程壳（M2-T8 · PRD §7.2.1 / §7.2.6 / §10.1）：上传 → 本地质量预检 → 层检测（可纠正）→ 管线 → 草稿。
 * 两入口共用；文案经 IntakeCopy 注入。所有失败分支渲染成可见卡片 + 可行动作，禁止静默吞错。
 */
export function IntakeFlow({ copy }: { copy: IntakeCopy }) {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [image, setImage] = useState<string | null>(null)
  const [issues, setIssues] = useState<QualityIssue[]>([])
  const [stageIdx, setStageIdx] = useState(0)
  const [feedback, setFeedback] = useState<IntakeFeedback | null>(null)
  const [mismatch, setMismatch] = useState<{ detected: string[]; suggestion: string } | null>(null)
  const [result, setResult] = useState<IntakeOk | null>(null)
  const [handoffNote, setHandoffNote] = useState<string | null>(null)

  const stages = STAGE_TEXT[copy.entry]

  // 上传中阶段文案推进（处理中状态明确，PRD §10.1）
  useEffect(() => {
    if (step !== 'processing') {
      setStageIdx(0)
      return
    }
    const timer = window.setInterval(() => setStageIdx((i) => Math.min(i + 1, stages.length - 1)), 900)
    return () => window.clearInterval(timer)
  }, [step, stages.length])

  /** 层检测纠偏的跨入口交接：对方入口页留下原图时，本页直接重跑（用户不必重新选文件）。 */
  useEffect(() => {
    const pending = useIntakeSession.getState().pendingImage
    if (pending && pending.fromEntry !== copy.entry) {
      setImage(pending.dataUrl)
      setHandoffNote(pending.note)
      void run(copy.entry, pending.dataUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyFailure(f: Failure) {
    setFeedback(mapIntakeFailure(f))
    setStep('failure')
  }

  async function run(targetEntry: Entry, dataUrl: string) {
    setStep('processing')
    const det = await detectImage(dataUrl, targetEntry)
    if (!det.ok) {
      applyFailure(det)
      return
    }
    if (det.data.unsupported) {
      setFeedback(
        mapIntakeFailure({
          status: 422,
          code: 'UNSUPPORTED_OBJECT',
          message: '层检测判定为不支持的对象（如散装药片），本次不进入提取管线。',
          details: { detected: det.data.layers },
        }),
      )
      setStep('failure')
      return
    }
    if (det.data.mismatch) {
      setMismatch({ detected: det.data.layers, suggestion: det.data.mismatch })
      setStep('mismatch')
      return
    }
    const res = targetEntry === 'A' ? await intakePrescription(dataUrl) : await intakeDrug(dataUrl)
    if (!res.ok) {
      applyFailure(res)
      return
    }
    // 原图进内存会话（确认页原文对照用）；交接图用完即清
    useIntakeSession.getState().setSession(res.data.draftIds, dataUrl)
    useIntakeSession.getState().setPendingImage(null)
    if (res.data.draftIds.length === 1) {
      navigate(`/drafts/${res.data.draftIds[0]}`)
      return
    }
    setResult(res.data)
    setStep('drafts')
  }

  async function onFile(file: File) {
    const problem = validateFile(file)
    if (problem) {
      toast.error(problem)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      setImage(dataUrl)
      void (async () => {
        const stats = await computeImageStats(dataUrl)
        const found = stats ? assessQuality(stats) : []
        if (found.length > 0) {
          setIssues(found)
          setStep('quality')
          return
        }
        await run(copy.entry, dataUrl)
      })()
    }
    reader.onerror = () => toast.error('读取图片失败，请重试')
    reader.readAsDataURL(file)
  }

  function backToUpload() {
    useIntakeSession.getState().setPendingImage(null)
    setImage(null)
    setIssues([])
    setFeedback(null)
    setMismatch(null)
    setResult(null)
    setHandoffNote(null)
    setStep('upload')
  }

  function switchEntry() {
    if (!image) return
    useIntakeSession.getState().setPendingImage({
      dataUrl: image,
      fromEntry: copy.entry,
      note: mismatch?.suggestion ?? feedback?.body ?? '',
    })
    navigate(copy.otherEntryPath)
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div className="space-y-4">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            Capture &amp; extract · 入口{copy.entry}
          </p>
          <h1 className="text-2xl font-bold">{copy.pageTitle}</h1>
          <p className="text-sm text-muted-foreground">{copy.pageLead}</p>
        </header>

        {step === 'upload' && (
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
                上传即表示你了解图片可能包含个人健康信息。原图只在本次会话的浏览器内存中使用；服务端只做白名单解析与四层脱敏，原文即用即弃、不存图片字节。
              </p>
              <Button variant="ghost" className="min-h-10" onClick={() => navigate(copy.otherEntryPath)}>
                <SwitchCamera className="size-4" aria-hidden /> 换个入口（{copy.otherEntryLabel}）
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'quality' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <TriangleAlert className="size-5 text-risk-l3" aria-hidden />
                照片质量可能影响识别
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-2">
                {issues.map((issue) => (
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
                <Button variant="outline" className="min-h-11 flex-1" onClick={backToUpload}>
                  <RotateCcw className="size-4" aria-hidden /> 重拍 / 换一张
                </Button>
                <Button className="min-h-11 flex-1" onClick={() => image && void run(copy.entry, image)}>
                  <Camera className="size-4" aria-hidden /> 仍要上传
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 'processing' && (
          <Card>
            <CardContent className="space-y-4 py-6">
              {image ? (
                <div className="relative overflow-hidden rounded-lg border">
                  <img src={image} alt="待识别图片" className="max-h-72 w-full object-contain" />
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
                      i < stageIdx ? 'text-muted-foreground' : i === stageIdx ? 'font-semibold' : 'text-muted-foreground/60',
                    )}
                  >
                    {i < stageIdx ? (
                      <Check className="size-4 shrink-0 text-risk-l1" aria-hidden />
                    ) : i === stageIdx ? (
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

        {step === 'mismatch' && mismatch && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldAlert className="size-5 text-risk-l3" aria-hidden />
                检测结果与所选入口不符
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {handoffNote && <p className="text-sm text-muted-foreground">{handoffNote}</p>}
              <p className="text-sm">{mismatch.suggestion}</p>
              <p className="flex flex-wrap gap-2">
                {mismatch.detected.map((layer) => (
                  <span key={layer} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                    {layer}
                  </span>
                ))}
              </p>
              <p className="text-xs text-muted-foreground">
                层检测是<strong>校验</strong>而不是分流 —— 系统不会静默改道。服务端对入口有硬校验，按当前入口继续通常仍会被拒绝。
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="min-h-11 flex-1" onClick={switchEntry}>
                  <SwitchCamera className="size-4" aria-hidden /> 切换到「{copy.otherEntryLabel}」重跑
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11 flex-1"
                  onClick={() => image && void run(copy.entry, image)}
                >
                  检测错了 · 按当前入口重试
                </Button>
                <Button variant="ghost" className="min-h-11 flex-1" onClick={backToUpload}>
                  <RotateCcw className="size-4" aria-hidden /> 重新上传
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 'failure' && feedback && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertTriangle className="size-5 text-risk-l4" aria-hidden />
                {feedback.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">{feedback.body}</p>
              {feedback.detected.length > 0 && (
                <p className="flex flex-wrap gap-2">
                  {feedback.detected.map((layer) => (
                    <span key={layer} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                      {layer}
                    </span>
                  ))}
                </p>
              )}
              <ul className="space-y-1 text-sm text-muted-foreground">
                {feedback.hints.map((hint) => (
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
                <Button className="min-h-11 flex-1" onClick={backToUpload}>
                  <RotateCcw className="size-4" aria-hidden /> 重新上传
                </Button>
                {feedback.allowManual && (
                  <Button variant="outline" className="min-h-11 flex-1" onClick={() => navigate('/box?manual=1')}>
                    <Hand className="size-4" aria-hidden /> 手动建档（不经识别）
                  </Button>
                )}
                {feedback.allowSwitch && (
                  <Button variant="ghost" className="min-h-11 flex-1" onClick={() => navigate(copy.otherEntryPath)}>
                    <SwitchCamera className="size-4" aria-hidden /> 换到「{copy.otherEntryLabel}」
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {step === 'drafts' && result && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ListChecks className="size-5 text-primary" aria-hidden />
                识别完成：{result.drafts.length} 份草稿待确认
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                一张处方笺含多个药品时拆成多份「档案 + 计划」草稿；确认页是唯一闸门，请<strong>逐个</strong>核对确认。
              </p>
              <ul className="space-y-2">
                {result.drafts.map((draft, i) => (
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
                    <Button className="min-h-10 shrink-0" onClick={() => navigate(`/drafts/${draft.id}`)}>
                      去确认 <ChevronRight className="size-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
              <Button variant="ghost" className="min-h-10" onClick={backToUpload}>
                <RotateCcw className="size-4" aria-hidden /> 再传一张
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <aside className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{copy.entry === 'A' ? '处方笺拍摄要点' : '药盒拍摄要点'}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {copy.guidePoints.map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-risk-l1" aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 py-4 text-sm">
            <p className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                <strong>四层脱敏</strong>：版面裁剪 / 闭合白名单 / 兜底扫描 / 出口约束。患者姓名、电话等身份信息结构上进不了系统。
              </span>
            </p>
            <p className="flex items-start gap-2">
              <ScanLine className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                <strong>只抄录不生成</strong>：用法用量只来自处方原文；药盒 / 医院标签上的用法不会被自动抄录。
              </span>
            </p>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              重拍清单：{RETAKE_CHECKLIST.join('；')}。
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}

/** 草稿概要徽章：冲突 / 需人工补 / 标签不抄录 / 降级 —— 让用户在列表页就知道每份草稿要核对什么。 */
function DraftChips({ draft }: { draft: DraftSummary }) {
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
