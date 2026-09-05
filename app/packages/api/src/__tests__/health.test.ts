/**
 * T5 集成测试（app.request()，不占端口；执行总纲 §3.3）。
 * 依赖：dev 库已迁移（T3）+ 已 db:seed-users（p-001 存在）。T6 迁独立测试库 + 自动 setup。
 */
import { describe, it, expect } from 'vitest'
import { app } from '../app.js'

describe('GET /api/health', () => {
  it('返回 200 且 { ok: true }（DB ping + 版本）', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; db: string; version: string }
    expect(body.ok).toBe(true)
    expect(body.db).toBe('up')
    expect(typeof body.version).toBe('string')
  })
})

describe('POST /api/records —— 入参校验分支', () => {
  it('空 body → 400 且 { ok:false, code:VALIDATION }', async () => {
    const res = await app.request('/api/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('VALIDATION')
  })
})
