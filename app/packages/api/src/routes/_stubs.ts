/**
 * 剩余路由骨架 —— M3 才实现的路径先返回 501 占位。
 * intake/detect·prescription·drug 与 drafts GET·confirm·reject 已在 M2-T6 换真实路由。
 * /api/consult 已在 M3-T1 换真实路由（routes/consult.ts）。
 */
import type { Hono, Context } from 'hono'
import type { AppEnv } from '../types.js'
import { errJson } from '../lib/http.js'

export function registerStubs(app: Hono<AppEnv>): void {
  const stub = (c: Context) => errJson(c, 'NOT_IMPLEMENTED', '路由骨架占位，M2/M3 实现', 501)

  // 医生端洞察（M3-T3）。健康信息 /api/profile 已在 T9 换真实路由（profiles.ts）。
  app.get('/api/insight/patients', stub)
  app.post('/api/insight/summary', stub)
}
