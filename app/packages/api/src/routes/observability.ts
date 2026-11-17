/**
 * GET /api/observability/summary（G10）—— 运维观测快照，注册在 resolveUser 之前（独立 token 鉴权）。
 *
 * 鉴权（不做用户登录依赖）：
 * - `OBS_ADMIN_TOKEN` 未设置 → 404（与 notFound 同文案，不暴露端点存在性）；
 * - 请求头 `x-obs-token` 与 env 常量时间比较（crypto.timingSafeEqual；长度不等直接 false）；
 *   缺失/错误 → 401。
 *
 * 返回 { ok:true, data: ObservabilitySummary }；无 PII（见 lib/observability/index.ts）。
 */
import { timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import { ERR_CODES } from '@anxin/shared'
import type { AppEnv } from '../types.js'
import { errJson } from '../lib/http.js'
import { getObservabilitySummary } from '../lib/observability/index.js'

/** 观测 token 请求头。 */
export const OBS_TOKEN_HEADER = 'x-obs-token'

/** 常量时间字符串比较（长度不等直接 false——timingSafeEqual 要求等长 Buffer）。 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export const observabilitySummaryHandler = async (c: Context<AppEnv>) => {
  const expected = (process.env.OBS_ADMIN_TOKEN ?? '').trim()
  // 未配置 = 端点不存在（不暴露存在性，与 app.notFound 文案逐字一致）。
  if (!expected) {
    return errJson(c, ERR_CODES.NOT_FOUND, '路由不存在', 404)
  }

  const provided = (c.req.header(OBS_TOKEN_HEADER) ?? '').trim()
  if (!constantTimeEquals(provided, expected)) {
    return errJson(c, ERR_CODES.AUTH_INVALID, '观测接口鉴权失败', 401)
  }

  return c.json({ ok: true as const, data: getObservabilitySummary() })
}
