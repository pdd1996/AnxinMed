/**
 * 异常 → 用户可读中文（G8）—— web 与 App 共用的唯一归类真相。
 *
 * 背景（specs/13 §9.8）：断网冷启动时 `bootstrapAuth` 把 RN / 浏览器抛出的原始英文异常
 * （`Failed to fetch` / `Network request failed` / `fetch failed: java.net.ConnectException…`）
 * 直接写进 store 并展示给老年用户。本模块把这些技术异常收敛成「发生了什么 + 能做什么」的中文；
 * 服务端已经返回中文 message 时**原样透传**（服务端更清楚上下文，如「账号或密码错误」）。
 *
 * 归类顺序（先具体后笼统）：
 *   1. ApiRequestError：中文 message 透传；英文按 code/status 归类（401/429/5xx/400…）；
 *   2. 超时 / AbortError → 请求超时；
 *   3. TypeError / Failed to fetch / Network request failed / ENOTFOUND / ECONNREFUSED / socket… → 网络连接失败；
 *   4. JSON 解析类（SyntaxError / Unexpected token…）→ 服务返回异常；
 *   5. 其余 → 调用方 fallback；fallback 不含中文时用通用中文兜底。
 *
 * 硬约束：任何分支都不返回纯英文技术串（specs/13 §9.8 的返工点）。失败仍然可见——
 * 本模块只换措辞，不吞错、不把失败降级成成功。
 */
import { ERR_CODES } from '@anxin/shared'
import { ApiRequestError } from '../api/client'
import {
  AUTH_LOCKED_MESSAGE,
  AUTH_SESSION_MESSAGE,
  BAD_RESPONSE_ERROR_MESSAGE,
  DEFAULT_USER_MESSAGE,
  FORBIDDEN_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  NOT_FOUND_MESSAGE,
  RATE_LIMITED_MESSAGE,
  SERVER_UNAVAILABLE_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  VALIDATION_MESSAGE,
} from './error-messages'

export * from './error-messages'

/** 中日韩统一表意文字（含扩展 A）：判断文案是否已是用户可读的中文。 */
const CJK_PATTERN = /[\u3400-\u9fff]/

/** 超时 / 主动取消（浏览器 AbortError、RN abort、Node ETIMEDOUT / ECONNABORTED）。 */
const TIMEOUT_PATTERN = /abort|timed?\s?out|timeout|etimedout/i

/**
 * 网络不可达（浏览器、RN、Node 及 Java 网络栈的措辞都收进来）：
 * Failed to fetch / fetch failed / Network request failed / ENOTFOUND / EAI_AGAIN /
 * ECONNREFUSED / socket closed / java.net.ConnectException / UnknownHostException…
 */
const NETWORK_PATTERN =
  /failed to fetch|fetch failed|network request failed|network error|networkerror|network connection|internet connection|offline|unknownhost|enotfound|eai_again|econnrefused|econnreset|econnaborted|connection refused|connection reset|connection closed|failed to connect|unable to connect|connectexception|unable to resolve|getaddrinfo|socket/i

/** JSON 解析失败（fetch 到网关错误页 / 空响应后 res.json() 抛错）。 */
const JSON_PARSE_PATTERN =
  /unexpected token|unexpected end of json|not valid json|invalid json|json parse|is not valid json/i

/** 读取异常的 message（Error 实例、普通对象、直接 throw 字符串都兼容）。 */
function messageOf(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

/** 读取异常的 name（AbortError / TimeoutError / SyntaxError 判定用，不依赖 DOM lib）。 */
function nameOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return ''
}

/** 是否含中文：中文 message 一律原样透传（服务端文案优先）。 */
function containsChinese(text: string): boolean {
  return CJK_PATTERN.test(text)
}

/** 兜底文案也必须中文；调用方传了英文 fallback 时退回通用中文兜底。 */
function normalizeFallback(fallback?: string): string {
  const trimmed = typeof fallback === 'string' ? fallback.trim() : ''
  return containsChinese(trimmed) ? trimmed : DEFAULT_USER_MESSAGE
}

function isTimeoutError(name: string, message: string): boolean {
  return name === 'AbortError' || name === 'TimeoutError' || TIMEOUT_PATTERN.test(message)
}

function isJsonParseError(name: string, message: string): boolean {
  return name === 'SyntaxError' || JSON_PARSE_PATTERN.test(message)
}

/** 英文 ApiRequestError → 中文；无法归类时返回 null（由调用方 fallback 接手）。 */
function apiRequestErrorMessage(error: ApiRequestError): string | null {
  const message = messageOf(error).trim()
  // 服务端已给中文：逐字透传，不用客户端猜测覆盖（登录失败/限流的具体措辞在服务端）。
  if (containsChinese(message)) return message

  const status = error.status
  const code = error.code
  const name = nameOf(error)

  // 请求根本没到服务端（status 0 由平台层合成）或异常本身是网络类 → 网络文案。
  if (status === 0 || NETWORK_PATTERN.test(message)) return NETWORK_ERROR_MESSAGE
  // 超时在 URL / status 之外也可能只剩 message，先于状态码判断。
  if (isTimeoutError(name, message)) return TIMEOUT_ERROR_MESSAGE
  if (isJsonParseError(name, message)) return BAD_RESPONSE_ERROR_MESSAGE

  if (code === ERR_CODES.AUTH_LOCKED) return AUTH_LOCKED_MESSAGE
  if (status === 429) return RATE_LIMITED_MESSAGE
  if (status === 401 || code === ERR_CODES.AUTH_INVALID || code === ERR_CODES.AUTH_REQUIRED) {
    return AUTH_SESSION_MESSAGE
  }
  if (status === 403) return FORBIDDEN_MESSAGE
  if (status === 404 || code === ERR_CODES.NOT_FOUND) return NOT_FOUND_MESSAGE
  if (status === 408) return TIMEOUT_ERROR_MESSAGE
  if (code === ERR_CODES.AI_UNAVAILABLE) return SERVER_UNAVAILABLE_MESSAGE
  if (status !== undefined && status >= 500) return SERVER_UNAVAILABLE_MESSAGE
  if (status === 400 || code === ERR_CODES.VALIDATION) return VALIDATION_MESSAGE
  return null
}

/**
 * 把任意异常换成用户能看懂的中文文案。
 *
 * @param error 任意 catch 到的异常（Error / ApiRequestError / string / 未知对象）
 * @param fallback 无法归类时的中文兜底（如「登录状态检查失败，请重试」）；不含中文时用通用兜底
 * @returns 一定包含中文的文案——绝不把纯英文技术串交给用户（CJK 检测兜底）
 */
export function toUserMessage(error: unknown, fallback?: string): string {
  const safeFallback = normalizeFallback(fallback)

  if (error instanceof ApiRequestError) {
    return apiRequestErrorMessage(error) ?? safeFallback
  }

  const message = messageOf(error).trim()
  // 非 ApiRequestError 的中文 message（如平台层合成的失败文案）同样原样透传。
  if (containsChinese(message)) return message

  const name = nameOf(error)
  if (isTimeoutError(name, message)) return TIMEOUT_ERROR_MESSAGE
  if (isJsonParseError(name, message)) return BAD_RESPONSE_ERROR_MESSAGE
  // 任务口径：TypeError 视为 fetch 类网络异常（web/RN 的 fetch 失败都是 TypeError）。
  if (error instanceof TypeError || NETWORK_PATTERN.test(message)) return NETWORK_ERROR_MESSAGE

  return safeFallback
}
