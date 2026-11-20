/**
 * /api/drugs 路由（薄）：入参 zValidator 校验，逻辑在 services，数据在 repositories。
 * 全部经 resolveUser 注入的 userId 过滤（多用户边界）。
 */
import { Hono } from 'hono'
import { DrugCreateSchema, DrugPatchSchema, ERR_CODES } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, okJson, ApiError } from '../lib/http.js'
import * as drugsService from '../services/drugs.service.js'
import { getLeafletForDrug } from '../services/leaflet.service.js'

// 链式定义：让路由类型逐条累积，供 app.ts 导出 AppType 后 hc<AppType> 端到端推导（handler 体不变）。
export const drugsRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const items = await drugsService.listDrugs(c.get('user').id)
    return okJson(c, { items })
  })
  .post('/', vJson(DrugCreateSchema), async (c) => {
    // V2.5：手动建档也返回入箱预检（手动无标准库身份 → 明示无法比对，不假装查过）
    const result = await drugsService.createManualDrug(c.get('user').id, c.req.valid('json'))
    return okJson(c, result, 201)
  })
  .get('/:id/leaflet', async (c) => {
    // 2026-11-20：说明书分段落页（咨询卡「查看完整说明书」入口）；本地未收录 → 404 可见
    const leaflet = await getLeafletForDrug(c.get('user').id, c.req.param('id'))
    if (!leaflet) {
      throw new ApiError(404, ERR_CODES.NOT_FOUND, '本地说明书库未收录该药的说明书')
    }
    return okJson(c, { leaflet })
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
