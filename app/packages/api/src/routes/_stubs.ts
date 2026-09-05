/**
 * 剩余路由骨架 —— M2/M3 才实现的路径先返回 501 占位（T7 已把 drugs/plans/tasks/records 换成真实路由）。
 */
import type { Hono, Context } from 'hono'
import type { AppEnv } from '../types.js'
import { errJson } from '../lib/http.js'

export function registerStubs(app: Hono<AppEnv>): void {
  const stub = (c: Context) => errJson(c, 'NOT_IMPLEMENTED', '路由骨架占位，M2/M3 实现', 501)

  // 拍照录入（M2）
  app.post('/api/intake/detect', stub)
  app.post('/api/intake/prescription', stub)
  app.post('/api/intake/drug', stub)

  // 草稿确认（M2）
  app.get('/api/drafts/:id', stub)
  app.post('/api/drafts/:id/confirm', stub)
  app.post('/api/drafts/:id/reject', stub)

  // AI 咨询（M3）/ 医生端洞察（M3）/ 健康信息（T9）
  app.post('/api/consult', stub)
  app.get('/api/insight/patients', stub)
  app.post('/api/insight/summary', stub)
  app.get('/api/profile', stub)
  app.patch('/api/profile', stub)
}
