/**
 * 有效期/开封日期录入（用户对照药盒自填）——API 契约与写入路径集成测试。
 *
 * 背景：PRD §7.3.4 的三条时间线里，`drugs.expiry`/`openedAt` 是用户域数据（执行总纲 §2.5），
 * 说明书库只有通用保质期、推不出某一盒的到期日，因此只能由用户录入。此前只有字段没有入口，
 * 本用例钉住「入口开放后」的契约：
 *   - 建档/编辑可写、可清空（null），GET 原样返回；
 *   - 日期必须是 YYYY-MM-DD 且为真实日历日（斜杠、不补零、2 月 31 日、非闰年 2 月 29 日一律 400）；
 *   - 允许过去日期（已过期药也要能录，供过期提示使用）；
 *   - PATCH 不存在/他人药品 → 404。
 */
import { describe, it, expect } from 'vitest'
import { app } from '../app.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

async function createDrug(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await req('POST', '/api/drugs', { genericName: '效期测试药', form: '片剂', ...extra })
  expect(res.status).toBe(201)
  return res.body.drug.id as string
}

async function cleanup(id: string) {
  await req('DELETE', `/api/drugs/${id}`)
}

describe('有效期/开封日期 · 建档与编辑契约', () => {
  it('手动建档时可带有效期 + 开封日期，GET 原样返回（用户自己录，不是模型输出）', async () => {
    const id = await createDrug({ expiry: '2027-03-01', openedAt: '2026-11-01' })
    try {
      const got = await req('GET', `/api/drugs/${id}`)
      expect(got.status).toBe(200)
      expect(got.body.drug).toMatchObject({
        genericName: '效期测试药',
        expiry: '2027-03-01',
        openedAt: '2026-11-01',
      })
    } finally {
      await cleanup(id)
    }
  })

  it('建档时不填 → null（药箱显示「待录入」，不是空串）', async () => {
    const id = await createDrug()
    try {
      const got = await req('GET', `/api/drugs/${id}`)
      expect(got.body.drug.expiry).toBeNull()
      expect(got.body.drug.openedAt).toBeNull()
    } finally {
      await cleanup(id)
    }
  })

  it('PATCH 可补录/修改效期与开封日期（药箱「编辑效期」入口的落库路径）', async () => {
    const id = await createDrug()
    try {
      const patched = await req('PATCH', `/api/drugs/${id}`, { expiry: '2026-12-31', openedAt: '2026-06-01' })
      expect(patched.status).toBe(200)
      expect(patched.body.drug).toMatchObject({ expiry: '2026-12-31', openedAt: '2026-06-01' })

      const got = await req('GET', `/api/drugs/${id}`)
      expect(got.body.drug).toMatchObject({ expiry: '2026-12-31', openedAt: '2026-06-01' })
    } finally {
      await cleanup(id)
    }
  })

  it('PATCH 传 null 可清空（录错/换新盒后可改）', async () => {
    const id = await createDrug({ expiry: '2027-03-01', openedAt: '2026-11-01' })
    try {
      const cleared = await req('PATCH', `/api/drugs/${id}`, { expiry: null, openedAt: null })
      expect(cleared.status).toBe(200)
      expect(cleared.body.drug.expiry).toBeNull()
      expect(cleared.body.drug.openedAt).toBeNull()
    } finally {
      await cleanup(id)
    }
  })

  it('允许过去日期（已过期药也要能录，过期判定由读取侧做）', async () => {
    const id = await createDrug({ expiry: '2020-01-01' })
    try {
      const got = await req('GET', `/api/drugs/${id}`)
      expect(got.body.drug.expiry).toBe('2020-01-01')
    } finally {
      await cleanup(id)
    }
  })
})

describe('有效期/开封日期 · 非法输入必须可见地失败（不静默吞）', () => {
  const rejected = [
    ['斜杠格式', '2027/03/01'],
    ['未补零', '2027-3-1'],
    ['带时间戳', '2027-03-01T00:00:00Z'],
    ['空串', ''],
    ['日历不存在（2 月 31 日）', '2026-02-31'],
    ['非闰年 2 月 29 日', '2025-02-29'],
    ['月份越界', '2026-13-01'],
  ] as const

  for (const [label, value] of rejected) {
    it(`建档：${label} → 400 VALIDATION`, async () => {
      const res = await req('POST', '/api/drugs', { genericName: '非法日期测试药', expiry: value })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('VALIDATION')
      expect(res.body.message).toContain('YYYY-MM-DD')
    })
  }

  it('PATCH：非法日期 → 400 VALIDATION，且原值不被改写', async () => {
    const id = await createDrug({ expiry: '2027-03-01' })
    try {
      const res = await req('PATCH', `/api/drugs/${id}`, { expiry: '2026-02-31' })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('VALIDATION')
      const got = await req('GET', `/api/drugs/${id}`)
      expect(got.body.drug.expiry).toBe('2027-03-01')
    } finally {
      await cleanup(id)
    }
  })

  it('PATCH 不存在的药品 → 404 NOT_FOUND', async () => {
    const res = await req('PATCH', '/api/drugs/does-not-exist', { expiry: '2027-03-01' })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })
})
