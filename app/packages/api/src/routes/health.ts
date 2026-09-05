/**
 * GET /api/health —— DB ping + 版本（公开 infra 路由，注册在 resolveUser 之前，不依赖用户解析）。
 */
import type { Context } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { okJson } from '../lib/http.js'
import type { AppEnv } from '../types.js'

const VERSION = '0.1.0'

// 不用 Handler<AppEnv> 宽化标注（否则返回型被抹为 Response，hc<AppType> 推不出健康检查响应体）。
export const healthHandler = async (c: Context<AppEnv>) => {
  // DB ping：失败则冒泡到 app.onError → 500（健康检查如实反映 DB 不可达）
  await db.execute(sql`select 1`)
  return okJson(c, { status: 'up', db: 'up', version: VERSION })
}
