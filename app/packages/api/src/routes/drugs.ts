/**
 * /api/drugs 路由（薄）：入参 zValidator 校验，逻辑在 services，数据在 repositories。
 * 全部经 resolveUser 注入的 userId 过滤（多用户边界）。
 */
import { Hono } from 'hono'
import { DrugCreateSchema, DrugPatchSchema, ERR_CODES } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, okJson, ApiError } from '../lib/http.js'
import * as drugsService from '../services/drugs.service.js'

// 链式定义：让路由类型逐条累积，供 app.ts 导出 AppType 后 hc<AppType> 端到端推导（handler 体不变）。
export const drugsRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const items = await drugsService.listDrugs(c.get('user').id)
    return okJson(c, { items })
  })
  .post('/', vJson(DrugCreateSchema), async (c) => {
    const drug = await drugsService.createManualDrug(c.get('user').id, c.req.valid('json'))
    return okJson(c, { drug }, 201)
  })
  .get('/:id', async (c) => {
    const drug = await drugsService.getDrug(c.get('user').id, c.req.param('id'))
    if (!drug) throw new ApiError(404, ERR_CODES.NOT_FOUND, '药品不存在')
    return okJson(c, { drug })
  })
  .patch('/:id', vJson(DrugPatchSchema), async (c) => {
    const drug = await drugsService.patchDrug(c.get('user').id, c.req.param('id'), c.req.valid('json'))
    if (!drug) throw new ApiError(404, ERR_CODES.NOT_FOUND, '药品不存在')
    return okJson(c, { drug })
  })
  .delete('/:id', async (c) => {
    const ok = await drugsService.deleteDrug(c.get('user').id, c.req.param('id'))
    if (!ok) throw new ApiError(404, ERR_CODES.NOT_FOUND, '药品不存在')
    return okJson(c, {})
  })
