/**
 * API 层共享类型。
 */
import { users } from './db/schema.js'

/** users 表行类型（drizzle 推导）。 */
export type User = typeof users.$inferSelect

/**
 * Hono 应用环境：resolveUser 注入 c.set('user', ...)，下游 c.get('user') 取用；
 * requestId 中间件注入 c.set('requestId', ...)，错误日志/响应头 x-request-id 取用（G10）。
 */
export type AppEnv = { Variables: { user: User; requestId: string } }
