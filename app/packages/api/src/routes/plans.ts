/**
 * /api/plans 路由（薄）。GET 支持 ?drugId= 过滤；POST 手动建计划（默认值标注规则在 service）。
 */
import { Hono } from 'hono'
import { PlanCreateSchema, PlanPatchSchema, ERR_CODES } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { vJson, okJson, ApiError } from '../lib/http.js'
import * as plansService from '../services/plans.service.js'

export const plansRoute = new Hono<AppEnv>()

plansRoute.get('/', async (c) => {
  const drugId = c.req.query('drugId') || undefined
  const items = await plansService.listPlans(c.get('user').id, drugId)
  return okJson(c, { items })
})

plansRoute.post('/', vJson(PlanCreateSchema), async (c) => {
  const plan = await plansService.createPlan(c.get('user').id, c.req.valid('json'))
  return okJson(c, { plan }, 201)
})

plansRoute.patch('/:id', vJson(PlanPatchSchema), async (c) => {
  const plan = await plansService.patchPlan(c.get('user').id, c.req.param('id'), c.req.valid('json'))
  if (!plan) throw new ApiError(404, ERR_CODES.NOT_FOUND, '计划不存在')
  return okJson(c, { plan })
})

plansRoute.delete('/:id', async (c) => {
  const ok = await plansService.deletePlan(c.get('user').id, c.req.param('id'))
  if (!ok) throw new ApiError(404, ERR_CODES.NOT_FOUND, '计划不存在')
  return okJson(c, {})
})
