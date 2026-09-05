/**
 * T7–T9 路由骨架 —— 全部挂上，handler 先返回 501 占位（技术方案 §5 / 任务书 T5）。
 * POST /api/records 额外挂真实 zValidator，用于验证 VALIDATION 分支（T7 实现前）。
 */
import type { Hono, Context } from 'hono'
import { z } from 'zod'
import { RecordStatusSchema } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, errJson } from '../lib/http.js'

// T7 POST /api/records 的入参契约骨架（body：{ planId, date, time, status }）
const RecordCreateSchema = z.object({
  planId: z.string().min(1),
  date: z.string().min(1), // ISO date "YYYY-MM-DD"
  time: z.string().min(1), // "HH:MM"
  status: RecordStatusSchema,
})

export function registerStubs(app: Hono<AppEnv>): void {
  const stub = (c: Context) => errJson(c, 'NOT_IMPLEMENTED', 'M1-T5 路由骨架占位，T7–T9 实现', 501)

  // 拍照录入（M2）
  app.post('/api/intake/detect', stub)
  app.post('/api/intake/prescription', stub)
  app.post('/api/intake/drug', stub)

  // 草稿确认（M2）
  app.get('/api/drafts/:id', stub)
  app.post('/api/drafts/:id/confirm', stub)
  app.post('/api/drafts/:id/reject', stub)

  // 药箱 / 计划 / 任务（T7）
  app.get('/api/drugs', stub)
  app.post('/api/drugs', stub)
  app.get('/api/drugs/:id', stub)
  app.patch('/api/drugs/:id', stub)
  app.delete('/api/drugs/:id', stub)
  app.get('/api/plans', stub)
  app.post('/api/plans', stub)
  app.patch('/api/plans/:id', stub)
  app.delete('/api/plans/:id', stub)
  app.get('/api/tasks/today', stub)

  // 服药记录（T7）：挂真实 zValidator 验证 VALIDATION 分支
  app.post('/api/records', vJson(RecordCreateSchema), stub)

  // AI 咨询（M3）/ 医生端洞察（M3）/ 健康信息（T9）
  app.post('/api/consult', stub)
  app.get('/api/insight/patients', stub)
  app.post('/api/insight/summary', stub)
  app.get('/api/profile', stub)
  app.patch('/api/profile', stub)
}
