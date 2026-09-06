/**
 * 剩余路由骨架 —— M2/M3 才实现的路径先返回 501 占位。
 * intake/detect·prescription·drug 与 drafts GET 已在 M2-T6a 换真实路由；confirm/reject 在 T6b 换。
 */
import type { Hono, Context } from 'hono'
import type { AppEnv } from '../types.js'
import { errJson } from '../lib/http.js'

export function registerStubs(app: Hono<AppEnv>): void {
  const stub = (c: Context) => errJson(c, 'NOT_IMPLEMENTED', '路由骨架占位，M2/M3 实现', 501)

  // 草稿确认（M2-T6b 换真实路由）
  app.post('/api/drafts/:id/confirm', stub)
  app.post('/api/drafts/:id/reject', stub)

  // AI 咨询（M3）/ 医生端洞察（M3）。健康信息 /api/profile 已在 T9 换真实路由（profiles.ts）。
  app.post('/api/consult', stub)
  app.get('/api/insight/patients', stub)
  app.post('/api/insight/summary', stub)
}
