/**
 * AI 客户端通用 HTTP 助手（M2-T1）：默认超时 30s、1 次重试、失败抛 AIUnavailableError。
 * 4xx（除 429）不重试（请求本身有问题）；5xx/429/网络/超时重试前退避（500ms 基数 + 随机抖动）
 * 后仍失败 → AIUnavailableError。
 */
import { AIUnavailableError, type ImageInput } from './types.js'

export interface CallOptions {
  client: 'qwen' | 'ocr' | 'baichuan'
  timeoutMs?: number
  retries?: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 重试前退避：500ms 基数 + 0–250ms 随机抖动，避免多实例同步打雷重试。仅对可重试失败生效（4xx 拒绝已在首轮抛出，不会进入下一轮）。 */
function backoffDelayMs(): number {
  return 500 + Math.random() * 250
}

export async function callJson<T>(url: string, init: RequestInit, opts: CallOptions): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const retries = opts.retries ?? 1
  let lastErr: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffDelayMs()) // 重试前退避（能走到第二轮的必是可重试失败）
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal })
      if (res.ok) return (await res.json()) as T
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new AIUnavailableError(opts.client, `${opts.client} 请求被拒 HTTP ${res.status}（不重试）`)
      }
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (e) {
      if (e instanceof AIUnavailableError) throw e
      lastErr = e
    } finally {
      clearTimeout(timer)
    }
  }
  throw new AIUnavailableError(
    opts.client,
    `${opts.client} 调用失败（超时/网络/5xx，已重试 ${retries} 次）`,
    lastErr,
  )
}

/** ImageInput → dataURL（qwen/ocr 图像入参共用：data:${mime};base64,${base64}）。 */
export function dataUrl(image: ImageInput): string {
  return `data:${image.mime};base64,${image.base64}`
}

/** OpenAI-compatible chat 响应 → 模型输出的 JSON 字符串 content。 */
export interface ChatResponse {
  choices?: { message?: { content?: string } }[]
}

export function extractChatContent(res: ChatResponse, client: 'qwen' | 'ocr' | 'baichuan'): string {
  const content = res.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new AIUnavailableError(client, `${client} 响应缺少 content`)
  }
  return content
}

/** 把模型输出的 JSON 字符串安全 parse 为 unknown（非 JSON → AIUnavailableError，不猜）。 */
export function parseModelJson(content: string, client: 'qwen' | 'ocr' | 'baichuan'): unknown {
  try {
    return JSON.parse(content)
  } catch (e) {
    throw new AIUnavailableError(client, `${client} 输出不是合法 JSON`, e)
  }
}
