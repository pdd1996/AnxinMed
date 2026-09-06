/**
 * T9 集成测试：/api/profile（health_profiles 按字段读写，app.request() 不占端口）。
 * 依赖：测试库 globalSetup 已 seed users（p-001 存在）；health_profiles 初始为空。
 */
import { describe, it, expect } from 'vitest'
import { app } from '../app.js'

type ProfileBody = {
  ok: boolean
  items: { id: string; fieldKey: string; value: string | null; sourceMeta: { source: string } | null }[]
}

async function patchProfile(payload: unknown) {
  return app.request('/api/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

describe('GET/PATCH /api/profile —— 健康信息按字段读写（T9）', () => {
  it('空 → upsert 性别 → 同字段更新 → 删除 → 空；手动写入标 self_reported', async () => {
    // 初始为空
    let res = await app.request('/api/profile')
    expect(res.status).toBe(200)
    let body = (await res.json()) as ProfileBody
    expect(body.ok).toBe(true)
    expect(body.items).toEqual([])

    // upsert 一条
    res = await patchProfile({ upserts: [{ fieldKey: '性别', value: '男' }] })
    expect(res.status).toBe(200)
    body = (await res.json()) as ProfileBody
    expect(body.items).toHaveLength(1)
    expect(body.items[0].fieldKey).toBe('性别')
    expect(body.items[0].value).toBe('男')
    expect(body.items[0].sourceMeta?.source).toBe('self_reported')

    // 同字段再 upsert → 更新而非新增
    res = await patchProfile({ upserts: [{ fieldKey: '性别', value: '女' }] })
    body = (await res.json()) as ProfileBody
    expect(body.items).toHaveLength(1)
    expect(body.items[0].value).toBe('女')

    // 删除 → 空
    res = await patchProfile({ deletes: ['性别'] })
    body = (await res.json()) as ProfileBody
    expect(body.items).toEqual([])
  })

  it('PATCH 入参校验：upsert 缺 value → 400 VALIDATION', async () => {
    const res = await patchProfile({ upserts: [{ fieldKey: '性别' }] })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('VALIDATION')
  })
})
