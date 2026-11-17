/**
 * 用户可读中文错误文案（G8）—— 统一收在这里，web 与 App 同一份口径。
 *
 * 单列文件的原因：`api/client.ts`（响应解析兜底）与 `lib/errors.ts`（异常归类）都要用，
 * 文案放这里两边都能引用，又不产生 client ↔ errors 的循环 import。
 *
 * 文案原则（适老化）：说「发生了什么 + 用户能做什么」，不出现 HTTP 状态码、异常类名、
 * 英文技术串（specs/13 §9.8：断网冷启动曾把原始英文异常直接展示给用户）。
 */

/** 网络不可达：浏览器 / RN / Node 三套异常措辞统一到这里。 */
export const NETWORK_ERROR_MESSAGE = '网络连接失败，请检查网络后重试'

/** 请求超时（AbortError / 客户端超时）。 */
export const TIMEOUT_ERROR_MESSAGE = '请求超时，请稍后重试'

/** 服务端返回体不是合法 JSON（网关 HTML 报错页、502 空响应等）。 */
export const BAD_RESPONSE_ERROR_MESSAGE = '服务返回异常，请稍后重试'

/** 客户端合成的「返回体不可解析」错误码（走 ApiRequestError.code 字段，不由服务端下发）。 */
export const BAD_RESPONSE_ERROR_CODE = 'BAD_RESPONSE'

/** 5xx / 识别等服务暂时不可用。 */
export const SERVER_UNAVAILABLE_MESSAGE = '服务暂时不可用，请稍后重试'

/** 401：登录态失效（token 过期 / 被登出 / 未登录）。 */
export const AUTH_SESSION_MESSAGE = '登录已失效，请重新登录'

/** 429 登录限流（G7：同一 IP+账号 5 次/15 分钟）。 */
export const AUTH_LOCKED_MESSAGE = '登录尝试次数过多，请稍后重试'

/** 429 其他接口限流。 */
export const RATE_LIMITED_MESSAGE = '操作太频繁，请稍后再试'

/** 403：没有操作权限。 */
export const FORBIDDEN_MESSAGE = '没有权限进行此操作'

/** 404：资源不存在（按用户语义说人话，不提「接口」）。 */
export const NOT_FOUND_MESSAGE = '内容不存在或已被删除'

/** 400 / 入参校验失败。 */
export const VALIDATION_MESSAGE = '填写内容有误，请检查后重试'

/** 未知异常的最终中文兜底（调用方传入的 fallback 不含中文时也用它，保证永远不露英文技术串）。 */
export const DEFAULT_USER_MESSAGE = '操作失败，请稍后重试'
