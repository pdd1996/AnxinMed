import { useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isSpeechSynthesisSupported, speak, stopSpeaking } from '@/lib/speech'

/**
 * 中文语音播报按钮（M3-T4 · spec §T4.2）——咨询回答可播放。
 *
 * - 纯图标（2026-09-21 UI 改版：去「播放/停止」文字，无障碍名走 aria-label/title）；
 * - 播放/停止切换：点击播放 → speechSynthesis 中文播报；再点击 → cancel 停止（VolumeX 静音图标）；
 * - 播放态自动复位，三重保障：onend 正常结束 / onerror 合成失败（speech.ts 内归一）/
 *   看门狗（3s 未 onstart，WebView 静默吞 speak() 时兜底）；卸载时停止，避免离开页面仍在念；
 * - 降级（spec §T4.3）：speechSynthesis 不可用或无文本时置灰 + title 文案说明，不抛错。
 *
 * 复用 @/lib/speech 的 speak/stopSpeaking（与 ReminderModal 同源，一处真相）。
 */
export interface SpeakButtonProps {
  /** 要播报的文本（中文）。 */
  text: string
  /** 无障碍标签，默认「播放回答」。 */
  label?: string
  /** 不支持语音合成时的降级文案。 */
  unsupportedHint?: string
  disabled?: boolean
  /** 按钮视觉变体（透传 Button）：与所在行的图标按钮族对齐，默认 outline。 */
  variant?: 'outline' | 'ghost'
  className?: string
}

export function SpeakButton({
  text,
  label = '播放回答',
  unsupportedHint = '当前浏览器不支持语音播报。',
  disabled = false,
  variant = 'outline',
  className,
}: SpeakButtonProps) {
  const [supported] = useState<boolean>(() => isSpeechSynthesisSupported())
  const [playing, setPlaying] = useState(false)
  // 用 ref 跟踪播放态，供卸载清理读取（避免闭包读到过期 state）。
  const playingRef = useRef(false)
  // 播放态看门狗定时器 id（卸载时清理，防 setState on unmounted）。
  const watchdogRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (playingRef.current) stopSpeaking()
      if (watchdogRef.current != null) window.clearTimeout(watchdogRef.current)
    }
  }, [])

  const hasText = Boolean(text.trim())
  const isDisabled = !supported || disabled || !hasText

  const resetPlaying = () => {
    if (watchdogRef.current != null) window.clearTimeout(watchdogRef.current)
    playingRef.current = false
    setPlaying(false)
  }

  const handleClick = () => {
    if (!supported || !hasText) return
    if (playing) {
      stopSpeaking()
      resetPlaying()
      return
    }
    playingRef.current = true
    setPlaying(true)
    // 看门狗：部分 WebView（如微信内置浏览器）speak() 静默无效果且不回调任何事件，
    // 3s 内未开声（onstart）则复位播放态，避免按钮卡在「停止」图标。
    let started = false
    watchdogRef.current = window.setTimeout(() => {
      if (!started && playingRef.current) resetPlaying()
    }, 3000)
    speak(text, {
      onStart: () => {
        started = true
      },
      onEnd: resetPlaying,
    })
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="icon"
      disabled={isDisabled}
      onClick={handleClick}
      aria-label={playing ? '停止播放' : label}
      title={supported ? (playing ? '停止播放' : label) : unsupportedHint}
      className={cn('min-h-9 min-w-9', className)}
    >
      {playing ? <VolumeX className="size-5" aria-hidden /> : <Volume2 className="size-5" aria-hidden />}
    </Button>
  )
}
