/**
 * /api/records 路由（薄）。GET /?from&to 按日周月范围查记录（M3-T6）；POST / 记录服药（taken/skipped/later），重复 → service 抛 409。
 * 入参契约 RecordCreateSchema / RecordsQuerySchema 在 shared（前后端一份真相）。
 *
 * GET /adherence-series（M5-T9）：患者端自查打卡时序，供 RN 依从图表。与医生端
 * /api/insight/patients/:id/adherence-series 同一 service、同一响应契约，区别只在 patientId 的来源——
 * 本路由从会话用户派生，不接受 URL 传 id，因此患者无法借它读别人的依从数据（医生端那条保留 :id 是有意的）。
 */
import { Hono } from 'hono'
import { RecordCreateSchema, RecordsQuerySchema, InsightAdherenceSeriesQuerySchema } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, vQuery, okJson } from '../lib/http.js'
import * as recordsService from '../services/records.service.js'
import * as insightService from '../services/insight.service.js'

// 链式定义（供 AppType 类型累积；handler 体不变）。
export const recordsRoute = new Hono<AppEnv>()
  .get('/', vQuery(RecordsQuerySchema), async (c) => {
    const result = await recordsService.queryRecords(c.get('user').id, c.req.valid('query'))
    return okJson(c, result)
  })
  .get('/adherence-series', vQuery(InsightAdherenceSeriesQuerySchema), async (c) => {
    const { days } = c.req.valid('query')
    const result = await insightService.getPatientAdherenceSeries(c.get('user').id, days)
    return okJson(c, result)
  })
  .post('/', vJson(RecordCreateSchema), async (c) => {
    const record = await recordsService.createRecord(c.get('user').id, c.req.valid('json'))
    return okJson(c, { record }, 201)
  })
