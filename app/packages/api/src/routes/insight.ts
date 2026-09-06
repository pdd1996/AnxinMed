/**
 * /api/insight 路由（M3-T3 · PRD §7.7）——薄层，仅处理 HTTP 请求解析与响应。
 *
 * GET  /api/insight/patients：患者列表 + 概要
 * POST /api/insight/summary：选定患者 → 组装 5 类数据 → Baichuan 生成摘要
 *
 * 守门与降级全部在 services/insight.service.ts 编排；本层不做业务判断。
 * LLM 不可用 → 离线降级（runInsightSummaryOffline），返回 200 + notice 说明。
 */
import { Hono } from 'hono'
import { InsightSummaryRequestSchema } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, okJson } from '../lib/http.js'
import * as insightService from '../services/insight.service.js'

export const insightRoute = new Hono<AppEnv>()
  .get('/patients', async (c) => {
    const items = await insightService.listPatients()
    return okJson(c, { items })
  })
  .post('/summary', vJson(InsightSummaryRequestSchema), async (c) => {
    const { patientId } = c.req.valid('json')
    const result = await insightService.generateSummary(patientId)
    return okJson(c, result)
  })
