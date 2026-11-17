/**
 * 请求级追踪 id 中间件（G10）：每个请求生成 crypto.randomUUID，写入 c.set('requestId', ...)
 * 与响应头 x-request-id，错误日志据此把「一次请求」串起来。
 *
 * 不信任客户端传入的 x-request-id（防伪造/注入）；始终服务端生成。
 */
import { randomUUID } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types.js'

export const REQUEST_ID_HEADER = 'x-request-id'

export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = randomUUID()
  c.set('requestId', requestId)
  // 必须在 next 之前设置：Hono 在生成下游响应（含 onError 兜底响应）时合并已 prepared 的头。
  c.header(REQUEST_ID_HEADER, requestId)
  await next()
})
