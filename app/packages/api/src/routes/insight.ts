/**
 * /api/insight 路由（M3-T3 · PRD §7.7）——薄层，仅处理 HTTP 请求解析与响应。
 *
 * 角色闸门（specs/25）：整组接口需 role='doctor'（demo 模式旁路）；
 * 数据作用域（能看到哪些患者）由 service 从绑定关系派生，见 binding.service.resolveDoctorPatientScope。
 *
 * GET  /api/insight/patients：患者列表 + 概要（仅当前医生授权患者）
 * GET  /api/insight/queue：队列视图数据（T7 · 分档统计 + 患者表 + 事件时间线，0 次 LLM 直查库）
 * POST /api/insight/summary：选定患者 → 组装 5 类数据 → 咨询文本模型生成摘要（未授权患者 404）
 * POST /api/insight/queue-summary：队列摘要（T7 · 咨询文本模型末端叙述 + guardSummary 守门 + 规则降级）
 * POST /api/insight/ask：医生问答（T7 · 两级意图路由——固定问法 0 次 LLM 直查库，长尾咨询模型叙述）
 *
 * 守门与降级全部在 services/insight.service.ts 编排；本层不做业务判断。
 * LLM 不可用 → 离线降级（runInsightSummaryOffline），返回 200 + notice 说明。
 */
import { Hono } from 'hono'
import {
  InsightAdherenceSeriesQuerySchema,
  InsightAskRequestSchema,
  InsightSummaryRequestSchema,
} from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, vQuery, okJson } from '../lib/http.js'
import { requireDoctor } from '../middleware/requireDoctor.js'
import * as insightService from '../services/insight.service.js'

export const insightRoute = new Hono<AppEnv>()
  // specs/25：医生端接口只对医生账号开放（demo 模式旁路，保既有演示/E2E 逐字不变）。
  .use('*', requireDoctor)
  .get('/patients', async (c) => {
    const items = await insightService.listPatients(c.get('user').id)
    return okJson(c, { items })
  })
  // 患者下钻打卡时序（T7 图表卡片 · 0 次 LLM 直查库；口径与队列视图同源）
  .get('/patients/:id/adherence-series', vQuery(InsightAdherenceSeriesQuerySchema), async (c) => {
    const { days } = c.req.valid('query')
    const result = await insightService.getPatientAdherenceSeries(c.get('user').id, c.req.param('id'), days)
    return okJson(c, result)
  })
  .get('/queue', async (c) => {
    const result = await insightService.getQueue(c.get('user').id)
    return okJson(c, result)
  })
  .post('/summary', vJson(InsightSummaryRequestSchema), async (c) => {
    const { patientId } = c.req.valid('json')
    const result = await insightService.generateSummary(c.get('user').id, patientId)
    return okJson(c, result)
  })
  .post('/queue-summary', async (c) => {
    const result = await insightService.generateQueueSummary(c.get('user').id)
    return okJson(c, result)
  })
  .post('/ask', vJson(InsightAskRequestSchema), async (c) => {
    const { question, patientId } = c.req.valid('json')
    const result = await insightService.insightAsk(c.get('user').id, question, patientId ?? null)
    return okJson(c, result)
  })
