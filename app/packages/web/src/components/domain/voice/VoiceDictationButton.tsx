import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Mic, RotateCcw, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'

/**
 * 按键式语音输入按钮（M3-T4 · spec §T4.1）——录入/咨询/健康信息填写页复用。
 *
 * 交互状态机：
 *   idle ──点击麦克风──▶ listening（实时回显 interim）──再点击/静音结束──▶ confirm
 *   confirm：展示定稿转写 + [填入]/[重说]/[取消]；「填入」经 onCommit 交回父级写入输入框。
 *
 * 关键约束：
 * - 语音只是快捷入口，父级必须保留等价的键盘/手动输入（spec §T4.1）；
 * - onCommit 走父级同一 setter，保证「语音路径与手动路径写入结果一致」（spec §T4 完成标准）；
 * - 降级（spec §T4.3）：不支持时按钮置灰 + title/aria 文案说明，主流程零阻塞、不抛错。
 * - 老年向：44px 触控靶（size-11）、图标 + 文字并用、点击外部/Esc 取消。
 */
export interface VoiceDictationButtonProps {
  /** 用户确认识别文本后回调；父级据此填入对应输入框（与手动输入同一 setter）。 */
  onCommit: (text: string) => void
  /** 无障碍标签 / 提示语，如「语音输入药名」。默认「语音输入」。 */
  label?: string
  /** 不支持语音识别时的降级文案（spec §T4.3）。 */
  unsupportedHint?: string
  /** 识别语言，默认 zh-CN。 */
  lang?: string
  /** 是否连续识别（长句可开），默认 false。 */
  continuous?: boolean
  /** 父表单忙时禁用（如提交中）。 */
  disabled?: boolean
  /** 确认浮层展开方向，默认向下；输入框贴近容器底部时用 'top' 向上展开。 */
  panelSide?: 'top' | 'bottom'
  className?: string
}

export function VoiceDictationButton({
  onCommit,
  label = '语音输入',
  unsupportedHint = '当前浏览器不支持语音输入，请直接手动填写。',
  lang = 'zh-CN',
  continuous = false,
  disabled = false,
  panelSide = 'bottom',
  className,
}: VoiceDictationButtonProps) {
  const { supported, listening, interim, transcript, error, start, stop, cancel, reset } = useSpeechRecognition({
    lang,
    continuous,
  })
  const wrapRef = useRef<HTMLDivElement>(null)
  // 用户手动停止但整轮没有任何定稿转写（且无错误）时置真，给可见反馈——避免浮层静默关闭（AGENTS.md 硬边界：失败必须可见）。
  const [stoppedEmpty, setStoppedEmpty] = useState(false)

  const finalText = transcript.trim()
  const panelOpen = listening || Boolean(finalText) || Boolean(error) || stoppedEmpty

  const handleCancel = useCallback(() => {
    setStoppedEmpty(false)
    cancel()
  }, [cancel])

  // 点击外部 / Esc：停止并取消（未确认的转写丢弃，避免浮层卡死）。
  useEffect(() => {
    if (!panelOpen) return
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) handleCancel()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel()
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [panelOpen, handleCancel])

  const handleMicClick = () => {
    if (!supported || disabled) return
    if (listening) {
      // 停止时若还没有任何定稿转写，标记为「空结果」以给出可见提示。
      if (!finalText) setStoppedEmpty(true)
      stop()
    } else {
      setStoppedEmpty(false)
      start()
    }
  }

  const handleCommit = () => {
    if (finalText) onCommit(finalText)
    setStoppedEmpty(false)
    reset()
  }

  const handleRetry = () => {
    setStoppedEmpty(false)
    reset()
    start()
  }

  return (
    <div
      ref={wrapRef}
      className={cn('relative inline-flex shrink-0', className)}
      title={supported ? undefined : unsupportedHint}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={!supported || disabled}
        onClick={handleMicClick}
        aria-label={listening ? '停止录音' : label}
        title={supported ? (listening ? '点击结束录音' : label) : unsupportedHint}
        className={cn(
          'size-11',
          listening && 'border-risk-l4 bg-risk-l4/10 text-risk-l4',
        )}
      >
        {listening ? <Square className="size-5 animate-pulse" aria-hidden /> : <Mic className="size-5" aria-hidden />}
      </Button>

      {/* 无障碍：实时播报聆听/识别状态 */}
      <p className="sr-only" role="status" aria-live="polite">
        {listening ? '正在聆听，请说话' : finalText ? `识别到：${finalText}` : ''}
      </p>

      {panelOpen && (
        <div
          className={cn(
            'absolute right-0 z-50 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-background p-3 shadow-lg',
            panelSide === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {listening && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative flex size-2.5 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-risk-l4 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-risk-l4" />
              </span>
              {interim ? <span className="text-foreground">「{interim}」</span> : '正在聆听，请说话…'}
            </p>
          )}

          {!listening && finalText && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">识别到（请确认后填入）：</p>
              <p className="rounded-md bg-muted/50 p-2 text-sm text-foreground">「{finalText}」</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" className="min-h-9 flex-1" onClick={handleCommit}>
                  <Check className="size-4" aria-hidden /> 填入
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-9"
                  onClick={handleRetry}
                  aria-label="重说一次"
                  title="重说一次"
                >
                  <RotateCcw className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-h-9"
                  onClick={handleCancel}
                  aria-label="取消语音输入"
                  title="取消"
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          )}

          {!listening && !finalText && !error && stoppedEmpty && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>未识别到语音。请点击麦克风重试，或直接手动输入。</span>
            </p>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-xs text-risk-l3">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
