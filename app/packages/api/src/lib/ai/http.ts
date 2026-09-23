/**
 * AI 客户端通用 HTTP 助手（M2-T1）：默认超时 30s、1 次重试、失败抛 AIUnavailableError。
 * 4xx（除 429）不重试（请求本身有问题）；5xx/429/网络/超时重试前退避（500ms 基数 + 随机抖动）
 * 后仍失败 → AIUnavailableError。
 */
import { AIUnavailableError, type AiClientName, type ImageInput } from './types.js'

export interface CallOptions {
  client: AiClientName
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
  choices?: { message?: { content?: string; reasoning_content?: string } }[]
}

export function extractChatContent(res: ChatResponse, client: AiClientName): string {
  const content = res.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new AIUnavailableError(client, `${client} 响应缺少 content`)
  }
  return content
}

/**
 * 严格模式取 content（P0 · docs/13 §4.3 #2）：`reasoning_content` 非空 = 思考泄漏，
 * 按契约判失败（默认失败更安全，不做 strip 放行）；content 空/缺失同样抛。
 */
export function extractChatContentStrict(res: ChatResponse, client: AiClientName): string {
  const msg = res.choices?.[0]?.message
  if (typeof msg?.reasoning_content === 'string' && msg.reasoning_content.length > 0) {
    throw new AIUnavailableError(client, `${client} 响应含思考泄漏（reasoning_content 非空），按契约判失败`)
  }
  return extractChatContent(res, client)
}

/**
 * 从模型输出中提取首个配平的 JSON 块（对象或数组；正确跳过字符串内的括号与转义）。
 * 模型常在 JSON 外夹带噪声——Markdown 栅栏、说明文字、追问（实测 baichuan-m3 检索模型
 * 会在答案 JSON 后追加第二轮 JSON）；这是确定性裁剪，不是内容猜测。
 */
export function extractFirstJsonBlock(content: string): string | null {
  const start = content.search(/[{[]/)
  if (start < 0) return null
  const open = content[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < content.length; i++) {
    const ch = content[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close && --depth === 0) return content.slice(start, i + 1)
  }
  return null
}

/**
 * 把模型输出的 JSON 字符串安全 parse 为 unknown。
 * 严格 parse 失败 → 截取首个配平 JSON 块重试；仍失败 → AIUnavailableError，不猜。
 * 内容合法性由下游 zod safeParse 把关（本函数只负责拿到候选 JSON）。
 */
export function parseModelJson(content: string, client: AiClientName): unknown {
  try {
    return JSON.parse(content)
  } catch (e) {
    const block = extractFirstJsonBlock(content)
    if (block !== null) {
      try {
        return JSON.parse(block)
      } catch {
        // 首块也不是合法 JSON → 落入统一报错
      }
    }
    throw new AIUnavailableError(client, `${client} 输出不是合法 JSON`, e)
  }
}
