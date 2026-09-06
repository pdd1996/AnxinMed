/**
 * /api/records 路由（薄）。GET /?from&to 按日周月范围查记录（M3-T6）；POST / 记录服药（taken/skipped/later），重复 → service 抛 409。
 * 入参契约 RecordCreateSchema / RecordsQuerySchema 在 shared（前后端一份真相）。
 */
import { Hono } from 'hono'
import { RecordCreateSchema, RecordsQuerySchema } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, vQuery, okJson } from '../lib/http.js'
import * as recordsService from '../services/records.service.js'

// 链式定义（供 AppType 类型累积；handler 体不变）。
export const recordsRoute = new Hono<AppEnv>()
  .get('/', vQuery(RecordsQuerySchema), async (c) => {
    const result = await recordsService.queryRecords(c.get('user').id, c.req.valid('query'))
    return okJson(c, result)
  })
  .post('/', vJson(RecordCreateSchema), async (c) => {
    const record = await recordsService.createRecord(c.get('user').id, c.req.valid('json'))
    return okJson(c, { record }, 201)
  })
