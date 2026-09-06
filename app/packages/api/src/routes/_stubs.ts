/**
 * 剩余路由骨架 —— M3 才实现的路径先返回 501 占位。
 * intake/detect·prescription·drug 与 drafts GET·confirm·reject 已在 M2-T6 换真实路由。
 * /api/consult 已在 M3-T1 换真实路由（routes/consult.ts）。
 * /api/insight/* 已在 M3-T3 换真实路由（routes/insight.ts）。
 */
import type { Hono, Context } from 'hono'
import type { AppEnv } from '../types.js'
import { errJson } from '../lib/http.js'

export function registerStubs(_app: Hono<AppEnv>): void {
  const stub = (c: Context) => errJson(c, 'NOT_IMPLEMENTED', '路由骨架占位，M2/M3 实现', 501)

  // 当前无剩余 stub；保留函数以便后续里程碑（如 P1 权限）新增占位。
  void stub
}
