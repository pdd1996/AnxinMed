/**
 * /api/drafts 路由（M2-T6，薄）。T6a：GET /:id 草稿详情（原文对照数据）。
 * T6b 追加 POST /:id/confirm（单事务原子写四表）、POST /:id/reject。
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types.js'
import { okJson } from '../lib/http.js'
import * as draftsService from '../services/drafts.service.js'

export const draftsRoute = new Hono<AppEnv>().get('/:id', async (c) => {
  const draft = await draftsService.getDraft(c.get('user').id, c.req.param('id'))
  return okJson(c, { draft })
})
