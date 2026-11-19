/**
 * requireDoctor 中间件（specs/25）——医生端接口的角色闸门。
 *
 * 语义：
 * - password 模式：当前账号 role 必须是 'doctor'，否则 403 FORBIDDEN（可见的中文说明）；
 * - demo 模式：整体旁路（p-001 旁路无角色语义）。这是既有 721 测试与 fixtures E2E 零回归的关键——
 *   医生端演示/E2E 在 demo 模式下必须逐字不变。
 *
 * 注意：本中间件只解决「是不是医生」，不解决「能看哪些患者」——数据作用域一律由
 * services/binding.service.resolveDoctorPatientScope 从绑定关系派生（ADR #23 第 1 条）。
 */
import { createMiddleware } from 'hono/factory'
import { BIND_DOCTOR_ONLY_MESSAGE, ERR_CODES } from '@anxin/shared'
import { ApiError } from '../lib/http.js'
import { readAuthMode } from '../lib/auth/mode.js'
import type { AppEnv } from '../types.js'

export const requireDoctor = createMiddleware<AppEnv>(async (c, next) => {
  if (readAuthMode() === 'demo') {
    await next()
    return
  }
  const user = c.get('user')
  if (user.role !== 'doctor') {
    throw new ApiError(403, ERR_CODES.FORBIDDEN, BIND_DOCTOR_ONLY_MESSAGE)
  }
  await next()
})
