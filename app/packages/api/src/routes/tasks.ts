/**
 * /api/tasks 路由（薄）。GET /today 支持 ?date= 覆盖（默认今天）。
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types.js'
import { okJson } from '../lib/http.js'
import * as tasksService from '../services/tasks.service.js'

export const tasksRoute = new Hono<AppEnv>()

tasksRoute.get('/today', async (c) => {
  const date = c.req.query('date') || undefined
  const result = await tasksService.getTodayTasks(c.get('user').id, date)
  return okJson(c, result)
})
