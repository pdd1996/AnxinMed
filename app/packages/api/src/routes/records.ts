/**
 * /api/records 路由（薄）。POST / 记录服药（taken/skipped/later）；重复 → service 抛 409。
 * 入参契约 RecordCreateSchema 在 shared（T5 曾在 stub 内联，T7 收敛到 shared 一份真相）。
 */
import { Hono } from 'hono'
import { RecordCreateSchema } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, okJson } from '../lib/http.js'
import * as recordsService from '../services/records.service.js'

// 链式定义（供 AppType 类型累积；handler 体不变）。
export const recordsRoute = new Hono<AppEnv>()
  .post('/', vJson(RecordCreateSchema), async (c) => {
    const record = await recordsService.createRecord(c.get('user').id, c.req.valid('json'))
    return okJson(c, { record }, 201)
  })
