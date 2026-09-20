/**
 * /api/consult 路由（M3-T1 · PRD §7.5；M4-T5 会话化）——薄层，仅处理 HTTP 请求解析与响应。
 *
 * POST /api/consult：{ question, drugIds[], sessionId?, skillId? } →
 *   { riskLevel, status, answer, sections?, citations[], notice?, l0Notice?, blocked, consultLogId, sessionId }
 *   sessionId 首答回传（无入参 → 服务端建会话）；续问带回即同会话下一轮。
 * GET /api/consult/sessions：本人会话列表（last_active_at 倒序）。
 * GET /api/consult/sessions/:id：会话详情（consult_logs 按 turn_no 回放）；跨用户/不存在 → 404。
 *
 * 守门与降级全部在 services/consult.service.ts 编排；本层不做业务判断。
 * L4/L3/manual-gate/no-source/ai-unavailable 均返回 200（守门正常路径，非错误）；
 * 未预期错误经 app.onError 兜底为 500 INTERNAL。
 */
import { Hono } from 'hono'
import { ConsultRequestSchema, ERR_CODES } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, okJson, ApiError } from '../lib/http.js'
import * as consultService from '../services/consult.service.js'

export const consultRoute = new Hono<AppEnv>()
  .post(
    '/',
    vJson(ConsultRequestSchema),
    async (c) => {
      const { question, drugIds, sessionId, skillId } = c.req.valid('json')
      const result = await consultService.consult(c.get('user').id, question, drugIds, { sessionId, skillId })
      return okJson(c, result)
    },
  )
  .get('/sessions', async (c) => {
    const items = await consultService.listSessions(c.get('user').id)
    return okJson(c, {
      items: items.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
      })),
    })
  })
  .get('/sessions/:id', async (c) => {
    const detail = await consultService.getSessionDetail(c.get('user').id, c.req.param('id'))
    if (!detail) {
      // 既有模式：404 走 ApiError 抛错（路由类型只含成功形态，hc<AppType> 推导干净）
      throw new ApiError(404, ERR_CODES.NOT_FOUND, '会话不存在或已失效')
    }
    return okJson(c, detail)
  })
