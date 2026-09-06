/**
 * /api/consult 路由（M3-T1 · PRD §7.5）——薄层，仅处理 HTTP 请求解析与响应。
 *
 * POST /api/consult：{ question, drugIds[] } → { riskLevel, status, answer, sections?, citations[], notice?, l0Notice?, blocked, consultLogId }
 *
 * 守门与降级全部在 services/consult.service.ts 编排；本层不做业务判断。
 * L4/L3/manual-gate/no-source/ai-unavailable 均返回 200（守门正常路径，非错误）；
 * 未预期错误经 app.onError 兜底为 500 INTERNAL。
 */
import { Hono } from 'hono'
import { ConsultRequestSchema } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, okJson } from '../lib/http.js'
import * as consultService from '../services/consult.service.js'

export const consultRoute = new Hono<AppEnv>().post(
  '/',
  vJson(ConsultRequestSchema),
  async (c) => {
    const { question, drugIds } = c.req.valid('json')
    const result = await consultService.consult(c.get('user').id, question, drugIds)
    return okJson(c, result)
  },
)
