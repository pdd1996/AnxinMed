/**
 * resolveUser 中间件 —— 注入当前用户（MVP：固定演示用户 p-001）。
 */
import { createMiddleware } from 'hono/factory'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { ApiError } from '../lib/http.js'
import type { AppEnv } from '../types.js'

/** MVP 演示用户 id（由 db:seed-users 写入）。 */
const DEMO_USER_ID = 'p-001'

/**
 * MVP：从 DB 读固定演示用户 p-001 → c.set('user')；读不到抛 500（不静默）。
 *
 * ⚠️ 唯一 P1 替换点：接入 Better Auth（手机号验证码 session）时，仅替换本函数体——
 *    改为从 Better Auth session 解析 user 并 c.set('user', ...)；下游所有 c.get('user') 不变。
 */
export const resolveUser = createMiddleware<AppEnv>(async (c, next) => {
  const [user] = await db.select().from(users).where(eq(users.id, DEMO_USER_ID)).limit(1)
  if (!user) {
    throw new ApiError(500, 'INTERNAL', `演示用户 ${DEMO_USER_ID} 未找到，请先运行 db:seed-users`)
  }
  c.set('user', user)
  await next()
})
