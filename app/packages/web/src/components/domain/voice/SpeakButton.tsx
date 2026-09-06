import { useEffect, useRef, useState } from 'react'
import { Square, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isSpeechSynthesisSupported, speak, stopSpeaking } from '@/lib/speech'

/**
 * 中文语音播报按钮（M3-T4 · spec §T4.2）——咨询回答可播放。
 *
 * - 播放/停止切换：点击播放 → speechSynthesis 中文播报；再点击 → cancel 停止；
 * - 播报结束（onend）自动复位播放态；卸载时停止，避免离开页面仍在念；
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
  className?: string
}

export function SpeakButton({
  text,
  label = '播放回答',
  unsupportedHint = '当前浏览器不支持语音播报。',
  disabled = false,
  className,
}: SpeakButtonProps) {
  const [supported] = useState<boolean>(() => isSpeechSynthesisSupported())
  const [playing, setPlaying] = useState(false)
  // 用 ref 跟踪播放态，供卸载清理读取（避免闭包读到过期 state）。
  const playingRef = useRef(false)

  useEffect(() => {
    return () => {
      if (playingRef.current) stopSpeaking()
    }
  }, [])

  const hasText = Boolean(text.trim())
  const isDisabled = !supported || disabled || !hasText

  const handleClick = () => {
    if (!supported || !hasText) return
    if (playing) {
      stopSpeaking()
      playingRef.current = false
      setPlaying(false)
      return
    }
    playingRef.current = true
    setPlaying(true)
    speak(text, {
      onEnd: () => {
        playingRef.current = false
        setPlaying(false)
      },
    })
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isDisabled}
      onClick={handleClick}
      aria-label={playing ? '停止播放' : label}
      title={supported ? (playing ? '停止播放' : label) : unsupportedHint}
      className={cn('min-h-9 gap-1.5', className)}
    >
      {playing ? <Square className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
      <span>{playing ? '停止' : '播放'}</span>
    </Button>
  )
}
