/**
 * /api/profile 路由（薄）。GET 读全量健康信息；PATCH 按字段 upsert/删除（任务书 T9）。
 * 全部经 resolveUser 注入的 userId 过滤（多用户边界）。
 */
import { Hono } from 'hono'
import { ProfilePatchSchema } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, okJson } from '../lib/http.js'
import * as profilesService from '../services/profiles.service.js'

// 链式定义（供 AppType 类型累积；handler 体不变）。
export const profilesRoute = new Hono<AppEnv>()
  .get('/', async (c) => {
    const items = await profilesService.listProfile(c.get('user').id)
    return okJson(c, { items })
  })
  .patch('/', vJson(ProfilePatchSchema), async (c) => {
    const items = await profilesService.patchProfile(c.get('user').id, c.req.valid('json'))
    return okJson(c, { items })
  })
