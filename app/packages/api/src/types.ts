/**
 * API 层共享类型。
 */
import { users } from './db/schema.js'

/** users 表行类型（drizzle 推导）。 */
export type User = typeof users.$inferSelect

/** Hono 应用环境：resolveUser 注入 c.set('user', ...)，下游 c.get('user') 取用。 */
export type AppEnv = { Variables: { user: User } }
