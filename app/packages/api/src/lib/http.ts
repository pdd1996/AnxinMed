/**
 * HTTP 响应与校验助手 —— 统一 { ok, code, message } 约定（技术方案 §5 / 执行总纲 §3.1）。
 */
import type { Context } from 'hono'
import type { ContentfulStatusCode, SuccessStatusCode } from 'hono/utils/http-status'
import { zValidator } from '@hono/zod-validator'
import type { ZodSchema } from 'zod'
import { ERR_CODES } from '@anxin/shared'

/** 领域错误：携带 HTTP 状态 + 错误码 +（可选）结构化明细；app.onError 统一转 { ok:false, code, message, ...details }（不静默吞错）。 */
export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    /** 附加明细（如 LAYER_MISMATCH 的 { detected, suggestion }）；展开进错误响应体，向后兼容。 */
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * 成功响应：{ ok: true, ...data }（列表类由调用方传 items）。
 * 泛型 T 让 hc<AppType> 推出精确响应体（{ ok: true } & T）；status 收窄为 2xx 以保证 RPC 成功分支。
 */
export function okJson<T extends Record<string, unknown>>(
  c: Context,
  data: T,
  // 交集：既是 2xx 成功、又有内容体（排除 204/205），兼容 c.json 重载且保证 RPC 成功分支。
  status: SuccessStatusCode & ContentfulStatusCode = 200,
) {
  return c.json({ ok: true as const, ...data }, status)
}

/** 失败响应：{ ok: false, code, message }。ok 用 as const 与 okJson 组成判别联合，便于 web 端 unwrap 收窄。 */
export function errJson(c: Context, code: string, message: string, status: ContentfulStatusCode = 400) {
  return c.json({ ok: false as const, code, message }, status)
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

/** query 参数校验（GET，如 /api/records?from&to）：失败 → { ok:false, code:VALIDATION, message } 400。 */
export function vQuery<S extends ZodSchema>(schema: S) {
  return zValidator('query', schema, (result, c) => {
    if (!result.success) {
      const first = result.error.issues[0]
      const message = first ? `${first.path.join('.') || '(query)'}: ${first.message}` : '查询参数校验失败'
      return errJson(c, ERR_CODES.VALIDATION, message, 400)
    }
  })
}
