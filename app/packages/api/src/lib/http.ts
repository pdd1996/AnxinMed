/**
 * HTTP 响应与校验助手 —— 统一 { ok, code, message } 约定（技术方案 §5 / 执行总纲 §3.1）。
 */
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { zValidator } from '@hono/zod-validator'
import type { ZodSchema } from 'zod'
import { ERR_CODES } from '@anxin/shared'

/** 领域错误：携带 HTTP 状态 + 错误码；app.onError 统一转 { ok:false, code, message }（不静默吞错）。 */
export class ApiError extends Error {
  constructor(public status: ContentfulStatusCode, public code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 成功响应：{ ok: true, ...data }（列表类由调用方传 items）。 */
export function okJson(c: Context, data: Record<string, unknown>, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true, ...data }, status)
}

/** 失败响应：{ ok: false, code, message }。 */
export function errJson(c: Context, code: string, message: string, status: ContentfulStatusCode = 400) {
  return c.json({ ok: false, code, message }, status)
}

/** JSON body 校验（@hono/zod-validator 封装）：失败 → { ok:false, code:VALIDATION, message } 400。 */
export function vJson<S extends ZodSchema>(schema: S) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) {
      const first = result.error.issues[0]
      const message = first ? `${first.path.join('.') || '(body)'}: ${first.message}` : '请求体校验失败'
      return errJson(c, ERR_CODES.VALIDATION, message, 400)
    }
  })
}
