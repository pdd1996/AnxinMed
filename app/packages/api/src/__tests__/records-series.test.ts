/**
 * M5-T9 患者端自查打卡时序：GET /api/records/adherence-series。
 *
 * 与医生端 /api/insight/patients/:id/adherence-series 共用 service，故本文件不重测聚合口径
 * （补零 / expected / byDrug 降序由 insight-series.test.ts 锚定），只测两端点的边界差：
 * ① patientId 只能来自会话用户，URL 上塞谁都改不了口径；② 响应体过 shared 契约；③ days 仍走 safeParse。
 *
 * 测试库 resolveUser 固定注入演示用户 p-001（globalSetup 只 seed 该用户），
 * 因此断言全部锚定 p-001，不自建 fixture、不污染他人聚合。
 */
import { describe, it, expect } from 'vitest'
import { InsightAdherenceSeriesResponseSchema, todayStr, addDaysStr } from '@anxin/shared'
import { app } from '../app.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(path: string): Promise<{ status: number; body: any }> {
  const res = await app.request(path)
  return { status: res.status, body: await res.json() }
}

const SELF = '/api/records/adherence-series'
const DOCTOR = '/api/insight/patients/p-001/adherence-series'

describe('GET /api/records/adherence-series', () => {
  it('默认 30 天：响应过 shared 契约，窗口锚在今天是结束日', async () => {
    const { status, body } = await req(SELF)
    expect(status).toBe(200)
    const parsed = InsightAdherenceSeriesResponseSchema.safeParse(body)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(body.patientId).toBe('p-001')
    expect(body.days).toBe(30)
    expect(body.endDate).toBe(todayStr())
    expect(body.startDate).toBe(addDaysStr(todayStr(), -29))
    expect(body.series).toHaveLength(30)
  })

  it('与医生端同患者同窗口逐字一致（除 ok 外的全字段，保证两端口径不分叉）', async () => {
    const self = await req(`${SELF}?days=14`)
    const doctor = await req(`${DOCTOR}?days=14`)
    expect(self.status).toBe(200)
    expect(doctor.status).toBe(200)
    const { ok: _selfOk, ...selfRest } = self.body
    const { ok: _doctorOk, ...doctorRest } = doctor.body
    expect(selfRest).toEqual(doctorRest)
  })

  it('URL 上塞 patientId 改不了归属：仍返回会话用户自己的序列', async () => {
    const { body } = await req(`${SELF}?days=7&patientId=qs-1`)
    expect(body.patientId).toBe('p-001')
    expect(body.days).toBe(7)
    expect(body.series).toHaveLength(7)
  })

  it('days 参数 safeParse：越界/非整数 → 400 VALIDATION', async () => {
    for (const bad of ['0', '91', 'abc', '3.5']) {
      const { status, body } = await req(`${SELF}?days=${bad}`)
      expect(status, `days=${bad}`).toBe(400)
      expect(body.ok, `days=${bad}`).toBe(false)
      expect(body.code, `days=${bad}`).toBe('VALIDATION')
    }
  })
})
