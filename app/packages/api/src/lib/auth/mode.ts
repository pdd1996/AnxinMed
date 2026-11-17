/**
 * AUTH_MODE 读取（G7）：
 * - demo（默认）：注入演示用户 p-001，M1–M12 既有行为与 665 个测试逐字不变；
 * - password：账号密码登录（Bearer token）。
 *
 * 每请求读取（不缓存模块常量），便于测试按文件切换环境；非法值直接 500，
 * 不让拼错的配置静默退化到 demo（否则等于把 staging 裸奔）。
 */
import type { AuthMode } from '@anxin/shared'
import { ApiError } from '../http.js'

export function readAuthMode(): AuthMode {
  const raw = (process.env.AUTH_MODE ?? '').trim().toLowerCase()
  if (!raw || raw === 'demo') return 'demo'
  if (raw === 'password') return 'password'
  throw new ApiError(500, 'INTERNAL', `AUTH_MODE 配置非法：${raw}（只允许 demo | password）`)
}
