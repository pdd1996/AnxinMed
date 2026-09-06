/**
 * useSpeechRecognition（M3-T4 · spec §T4.1）——Web SpeechRecognition 生命周期封装。
 *
 * 职责：管理「开始聆听 → 实时中间结果 → 定稿转写 → 结束/出错」的状态机，
 * 供 VoiceDictationButton 消费。能力探测与错误映射委托 @/lib/speech（纯函数、可独立单测）。
 *
 * 降级（spec §T4.3）：不支持时 supported=false，start/stop/cancel 全部 no-op，主流程零阻塞、不抛错。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getSpeechRecognitionCtor,
  mapSpeechRecognitionError,
  type SpeechRecognitionInstanceLike,
} from '@/lib/speech'

export interface UseSpeechRecognitionOptions {
  /** BCP-47 语言标签，默认中文（spec §T4.2）。 */
  lang?: string
  /** 是否连续识别，默认 false（一句定稿即自动结束）。 */
  continuous?: boolean
  /** 是否返回实时中间结果，默认 true（边说边回显）。 */
  interimResults?: boolean
}

export interface UseSpeechRecognition {
  /** 当前浏览器是否支持语音识别（挂载时探测一次）。 */
  supported: boolean
  /** 是否正在聆听。 */
  listening: boolean
  /** 实时中间结果（未定稿，仅回显用）。 */
  interim: string
  /** 已定稿转写（多次 final 累积）。 */
  transcript: string
  /** 用户可读错误（中文），null 表示无错误。 */
  error: string | null
  /** 开始聆听（不支持时 no-op）。 */
  start: () => void
  /** 停止聆听，保留已定稿转写用于「转写确认」。 */
  stop: () => void
  /** 取消并清空全部状态（transcript/interim/error）。 */
  cancel: () => void
  /** 仅清空转写与错误，不触碰识别实例（用于确认后复位）。 */
  reset: () => void
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}): UseSpeechRecognition {
  const { lang = 'zh-CN', continuous = false, interimResults = true } = options

  // 能力探测只在挂载时做一次（浏览器能力在页面生命周期内不变）。
  const [supported] = useState<boolean>(() => getSpeechRecognitionCtor() !== null)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null)

  const start = useCallback(() => {
    if (!supported) return
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return

    // 中断上一轮实例（若仍存活），避免多次 start 叠加。
    const prev = recognitionRef.current
    if (prev) {
      try {
        prev.abort()
      } catch {
        /* 已结束，忽略 */
      }
    }

    // 新一轮开始，清空上一轮痕迹。
    setError(null)
    setInterim('')
    setTranscript('')

    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = continuous
    rec.interimResults = interimResults
    rec.maxAlternatives = 1

    rec.onstart = () => setListening(true)
    rec.onresult = (event) => {
      let finalChunk = ''
      let interimChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result?.[0]?.transcript ?? ''
        if (result?.isFinal) finalChunk += text
        else interimChunk += text
      }
      if (finalChunk) setTranscript((prevText) => prevText + finalChunk)
      setInterim(interimChunk)
    }
    rec.onerror = (event) => {
      const message = mapSpeechRecognitionError(event.error)
      if (message) setError(message)
      setListening(false)
    }
    rec.onend = () => {
      setListening(false)
      setInterim('')
    }

    recognitionRef.current = rec
    try {
      rec.start()
      // 乐观置位：部分实现 onstart 触发较晚，先给 UI 即时反馈。
      setListening(true)
    } catch {
      // start() 在已启动状态下会抛 InvalidStateError；转为可见提示，不静默吞错。
      setError('语音识别正在启动，请稍候再试。')
      setListening(false)
    }
  }, [supported, lang, continuous, interimResults])

  const stop = useCallback(() => {
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.stop()
      } catch {
        /* 已停止，忽略 */
      }
    }
    setListening(false)
  }, [])

  const cancel = useCallback(() => {
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.abort()
      } catch {
        /* 已结束，忽略 */
      }
    }
    setListening(false)
    setInterim('')
    setTranscript('')
    setError(null)
  }, [])

  const reset = useCallback(() => {
    setInterim('')
    setTranscript('')
    setError(null)
  }, [])

  // 卸载清理：摘掉回调并中断，防止内存泄漏与「幽灵识别」。
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current
      if (rec) {
        rec.onstart = null
        rec.onresult = null
        rec.onerror = null
        rec.onend = null
        try {
          rec.abort()
        } catch {
          /* 已结束，忽略 */
        }
      }
    }
  }, [])

  return { supported, listening, interim, transcript, error, start, stop, cancel, reset }
}
