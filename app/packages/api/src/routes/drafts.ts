/**
 * /api/drafts 路由（M2-T6，薄）。
 *   GET  /:id          草稿详情（原文对照数据）
 *   POST /:id/confirm  单事务原子写 drugs+plans+sources+health_profiles+drafts.status + 确认留痕
 *   POST /:id/reject   status=rejected 留痕
 * 逻辑在 drafts.service；入参 zod 校验（DraftConfirmSchema/DraftRejectSchema 在 shared）。
 */
import { Hono } from 'hono'
import { DraftConfirmSchema, DraftRejectSchema } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { okJson, vJson } from '../lib/http.js'
import * as draftsService from '../services/drafts.service.js'

export const draftsRoute = new Hono<AppEnv>()
  .get('/:id', async (c) => {
    const draft = await draftsService.getDraft(c.get('user').id, c.req.param('id'))
    return okJson(c, { draft })
  })
  .post('/:id/confirm', vJson(DraftConfirmSchema), async (c) => {
    const result = await draftsService.confirmDraft(c.get('user').id, c.req.param('id'), c.req.valid('json'))
    return okJson(c, result)
  })
  .post('/:id/reject', vJson(DraftRejectSchema), async (c) => {
    const result = await draftsService.rejectDraft(c.get('user').id, c.req.param('id'), c.req.valid('json'))
    return okJson(c, result)
  })
