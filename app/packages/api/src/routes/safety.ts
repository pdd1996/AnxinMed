/**
 * /api/safety 路由（薄）：患者端「用药安全」常驻汇总（V2.5 · PRD §7.8.2）。
 * 检查对象 = 生效计划集合（不是药箱库存）；0 次 LLM，规则只匹配不生成。
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types.js'
import { okJson } from '../lib/http.js'
import * as safetyService from '../services/safety.service.js'

export const safetyRoute = new Hono<AppEnv>().get('/', async (c) => {
  const summary = await safetyService.getSafetySummary(c.get('user').id)
  return okJson(c, summary)
})
