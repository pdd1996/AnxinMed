/**
 * 医患绑定路由（specs/25 · 演示最小闭环）。
 *
 * 医生端（需 role='doctor'）：
 *   POST /api/doctor/bind-code         生成一次性绑定码（旧未使用码作废）
 * 患者端（需登录；核销仅患者角色可用）：
 *   GET  /api/bindings                 我的医生列表
 *   POST /api/bindings/redeem          核销绑定码（患者+IP 双维度限流 → 超限 429 BIND_LOCKED）
 *   DELETE /api/bindings/:doctorId     解绑
 *
 * 薄层：只做 HTTP 解析与响应；角色/作用域/限流判定在 middleware / service。
 */
import { Hono } from 'hono'
import { BindRedeemRequestSchema } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { okJson, vJson } from '../lib/http.js'
import { clientIp } from '../lib/observability/rate-limit.js'
import { requireDoctor } from '../middleware/requireDoctor.js'
import * as bindingService from '../services/binding.service.js'

/** 医生端绑定接口（/api/doctor）。 */
export const doctorBindingRoute = new Hono<AppEnv>()
  .use('*', requireDoctor)
  .post('/bind-code', async (c) => okJson(c, await bindingService.createBindCode(c.get('user'))))
  // specs/25 增补：医生端解除患者（撤销权对称化；未绑定 → 404）。
  .delete('/bindings/:patientId', async (c) => {
    await bindingService.unbindPatientAsDoctor(c.get('user').id, c.req.param('patientId'))
    return okJson(c, { removed: true })
  })

/** 患者端绑定接口（/api/bindings）。 */
export const bindingRoute = new Hono<AppEnv>()
  .get('/', async (c) => okJson(c, await bindingService.listPatientDoctors(c.get('user').id)))
  .post('/redeem', vJson(BindRedeemRequestSchema), async (c) => {
    // clientKey 参与 IP 维度限流（x-forwarded-for 首段 / x-real-ip；直连为 'local'）。
    const result = await bindingService.redeemBindCode(
      c.get('user'),
      c.req.valid('json').code,
      clientIp(c),
    )
    return okJson(c, result)
  })
  .delete('/:doctorId', async (c) => {
    await bindingService.unbindDoctor(c.get('user').id, c.req.param('doctorId'))
    return okJson(c, { removed: true })
  })
