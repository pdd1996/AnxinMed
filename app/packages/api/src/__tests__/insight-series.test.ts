/**
 * T7 患者下钻打卡时序测试：GET /api/insight/patients/:id/adherence-series。
 *
 * 0 次 LLM 直查库端点——断言按日序列（taken/skipped/later/expected 补零口径）、
 * 按药品聚合（JOIN 排序）、窗口合计（口径同 getAdherenceStats）、days 参数 safeParse、404。
 *
 * 测试库 globalSetup 只 seed users（p-001），本文件自建 fixture（qs-1 + 两计划/两药品/
 * 五条 records），afterAll 清理；断言只锚定自建 id，不锚定全局总数（vitest 并行纪律）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { drugs, plans, records, users } from '../db/schema.js'
import { todayStr, addDaysStr } from '@anxin/shared'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(path: string): Promise<{ status: number; body: any }> {
  const res = await app.request(path)
  return { status: res.status, body: await res.json() }
}

const UID = 'qs-1'
const today = todayStr()

// 计划 A：10 天前起、每日 2 次（08:00/20:00）；计划 B：今天起、每日 1 次（09:00）
// → expected：今天 = 2 + 1 = 3；昨天/前天 = 2；更早 = 0（B 未生效）
const DAILY_A = ['08:00', '20:00']

beforeAll(async () => {
  await db.insert(users).values({ id: UID, name: '时序测试患者' })
  await db.insert(drugs).values([
    { id: 'qs-drug-a', userId: UID, genericName: '测试药A', confirmStatus: 'manual' },
    { id: 'qs-drug-b', userId: UID, genericName: '测试药B', confirmStatus: 'manual' },
  ])
  await db.insert(plans).values([
    {
      id: 'qs-plan-a',
      userId: UID,
      drugId: 'qs-drug-a',
      dose: { value: 1, unit: '片' },
      frequency: 2,
      times: DAILY_A,
      cycleType: 'open',
      startDate: addDaysStr(today, -10),
      status: 'active',
      source: 'manual',
    },
    {
      id: 'qs-plan-b',
      userId: UID,
      drugId: 'qs-drug-b',
      dose: { value: 1, unit: '片' },
      frequency: 1,
      times: ['09:00'],
      cycleType: 'open',
      startDate: today,
      status: 'active',
      source: 'manual',
    },
  ])
  // records：今天 taken1/skipped1/later1；昨天 taken2；前天无 → 缺打卡日补零口径
  await db.insert(records).values([
    { id: 'qs-rec-1', userId: UID, planId: 'qs-plan-a', scheduledDate: today, scheduledTime: '08:00', status: 'taken' },
    { id: 'qs-rec-2', userId: UID, planId: 'qs-plan-a', scheduledDate: today, scheduledTime: '20:00', status: 'skipped' },
    { id: 'qs-rec-3', userId: UID, planId: 'qs-plan-b', scheduledDate: today, scheduledTime: '09:00', status: 'later' },
    { id: 'qs-rec-4', userId: UID, planId: 'qs-plan-a', scheduledDate: addDaysStr(today, -1), scheduledTime: '08:00', status: 'taken' },
    { id: 'qs-rec-5', userId: UID, planId: 'qs-plan-a', scheduledDate: addDaysStr(today, -1), scheduledTime: '20:00', status: 'taken' },
  ])
})

afterAll(async () => {
  await db.delete(records).where(inArray(records.userId, [UID]))
  await db.delete(plans).where(inArray(plans.userId, [UID]))
  await db.delete(drugs).where(inArray(drugs.userId, [UID]))
  await db.delete(users).where(inArray(users.id, [UID]))
})

describe('GET /api/insight/patients/:id/adherence-series', () => {
  it('默认 30 天：序列长度、按日计数与 expected 补零口径', async () => {
    const { status, body } = await req(`/api/insight/patients/${UID}/adherence-series`)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.patientId).toBe(UID)
    expect(body.days).toBe(30)
    expect(body.endDate).toBe(today)
    expect(body.startDate).toBe(addDaysStr(today, -29))
    expect(body.series).toHaveLength(30)

    // 今天：taken 1 / skipped 1 / later 1，expected = A(2) + B(1) = 3
    expect(body.series.at(-1)).toEqual({ date: today, taken: 1, skipped: 1, later: 1, expected: 3 })
    // 昨天：taken 2，expected 仅计划 A = 2（B 今天才生效）
    expect(body.series.at(-2)).toEqual({ date: addDaysStr(today, -1), taken: 2, skipped: 0, later: 0, expected: 2 })
    // 前天：无任何记录 → 补零；expected 仍 = 2
    expect(body.series.at(-3)).toEqual({ date: addDaysStr(today, -2), taken: 0, skipped: 0, later: 0, expected: 2 })
    // 计划 A 起始当天（today-10）：startDate 当天即生效 → expected = 2
    expect(body.series.at(-11)).toEqual({ date: addDaysStr(today, -10), taken: 0, skipped: 0, later: 0, expected: 2 })
    // 计划 A 生效前一日（today-11）：expected = 0
    expect(body.series.at(-12)).toEqual({ date: addDaysStr(today, -11), taken: 0, skipped: 0, later: 0, expected: 0 })
  })

  it('窗口合计口径同 getAdherenceStats（total 含 later，rate = taken/total）', async () => {
    const { body } = await req(`/api/insight/patients/${UID}/adherence-series`)
    expect(body.adherence).toEqual({ rate: 60, taken: 3, skipped: 1, total: 5 })
  })

  it('byDrug 按通用名+商品名聚合且按打卡总量降序', async () => {
    const { body } = await req(`/api/insight/patients/${UID}/adherence-series?days=3`)
    expect(body.series).toHaveLength(3)
    expect(body.byDrug).toHaveLength(2)
    expect(body.byDrug[0]).toMatchObject({ genericName: '测试药A', taken: 3, skipped: 1, later: 0 })
    expect(body.byDrug[1]).toMatchObject({ genericName: '测试药B', taken: 0, skipped: 0, later: 1 })
  })

  it('days 参数 safeParse：越界/非整数 → 400 VALIDATION（不猜参数执行）', async () => {
    for (const bad of ['0', '91', 'abc', '3.5']) {
      const { status, body } = await req(`/api/insight/patients/${UID}/adherence-series?days=${bad}`)
      expect(status, `days=${bad}`).toBe(400)
      expect(body.ok, `days=${bad}`).toBe(false)
      expect(body.code, `days=${bad}`).toBe('VALIDATION')
    }
  })

  it('未知患者 → 404 NOT_FOUND（错误可见）', async () => {
    const { status, body } = await req('/api/insight/patients/qs-none/adherence-series')
    expect(status).toBe(404)
    expect(body.code).toBe('NOT_FOUND')
  })
})
