/**
 * M3-T6 · GET /api/records?from&to 集成测试（app.request()，独立测试库）。
 *
 * 覆盖（PRD §7.4「按日周月查询与导出」的后端契约）：
 * - 按日/范围/月边界查询，闭区间 [from,to]；
 * - 条目含 drugName（联 plans→drugs）+ 排序（日期倒序、同日时间正序）；
 * - summary 状态聚合（PG count filter）；
 * - 空区间 → items[] + summary 全 0；
 * - 校验：日期格式非法 / from>to → 400 VALIDATION。
 * 测试库 globalSetup 只 seed users，故本文件自建 drug/plan/records，afterAll 清理。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { drugMaster, drugs, plans, records } from '../db/schema.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await app.request(path)
  return { status: res.status, body: await res.json() }
}

const USER = 'p-001'
const DM = 'dm-t6-rec'
const DRUG = 'drug-t6-rec'
const PLAN = 'plan-t6-rec'
const rid = (date: string, time: string) => `${PLAN}__${date}__${time}`

beforeAll(async () => {
  await db.insert(drugMaster).values({ id: DM, genericName: '玻璃酸钠滴眼液', specification: '0.1%', form: '滴眼液' })
  await db.insert(drugs).values({
    id: DRUG,
    userId: USER,
    genericName: '玻璃酸钠滴眼液',
    specification: '0.1%',
    form: '滴眼液',
    drugMasterId: DM,
    confirmStatus: 'ocr_matched',
  })
  await db.insert(plans).values({
    id: PLAN,
    userId: USER,
    drugId: DRUG,
    dose: { value: 1, unit: '滴' },
    frequency: 2,
    times: ['08:00', '20:00'],
    cycleType: 'open',
    startDate: '2026-08-01',
    status: 'active',
    source: 'manual',
  })
  await db.insert(records).values([
    { id: rid('2026-09-01', '08:00'), userId: USER, planId: PLAN, scheduledDate: '2026-09-01', scheduledTime: '08:00', status: 'taken' },
    { id: rid('2026-09-01', '20:00'), userId: USER, planId: PLAN, scheduledDate: '2026-09-01', scheduledTime: '20:00', status: 'skipped' },
    { id: rid('2026-09-05', '08:00'), userId: USER, planId: PLAN, scheduledDate: '2026-09-05', scheduledTime: '08:00', status: 'taken' },
    { id: rid('2026-08-20', '08:00'), userId: USER, planId: PLAN, scheduledDate: '2026-08-20', scheduledTime: '08:00', status: 'later' },
  ])
})

afterAll(async () => {
  await db.delete(records).where(eq(records.userId, USER))
  await db.delete(plans).where(eq(plans.id, PLAN))
  await db.delete(drugs).where(eq(drugs.id, DRUG))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM))
})

describe('GET /api/records?from&to · 按日/周/月查询', () => {
  it('按日（from=to=2026-09-01）→ 2 条 + summary(taken1/skipped1) + 同日时间正序', async () => {
    const res = await get('/api/records?from=2026-09-01&to=2026-09-01')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.range).toEqual({ from: '2026-09-01', to: '2026-09-01' })
    expect(res.body.items).toHaveLength(2)
    expect(res.body.items[0].scheduledTime).toBe('08:00')
    expect(res.body.items[1].scheduledTime).toBe('20:00')
    expect(res.body.summary).toEqual({ total: 2, taken: 1, skipped: 1, later: 0 })
  })

  it('按周/范围（09-01..09-30）→ 3 条，日期倒序（09-05 在前）', async () => {
    const res = await get('/api/records?from=2026-09-01&to=2026-09-30')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(3)
    expect(res.body.items[0].scheduledDate).toBe('2026-09-05')
    expect(res.body.summary).toEqual({ total: 3, taken: 2, skipped: 1, later: 0 })
  })

  it('按月（08-01..08-31）→ 1 条（later），闭区间含边界', async () => {
    const res = await get('/api/records?from=2026-08-01&to=2026-08-31')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.summary).toEqual({ total: 1, taken: 0, skipped: 0, later: 1 })
  })

  it('条目含 drugName（联 plans→drugs）供 CSV 导出', async () => {
    const res = await get('/api/records?from=2026-09-01&to=2026-09-30')
    expect(res.body.items[0]).toMatchObject({
      planId: PLAN,
      drugName: '玻璃酸钠滴眼液',
      status: 'taken',
    })
    expect(typeof res.body.items[0].actedAt).toBe('string') // ISO datetime
  })

  it('空区间（未来）→ items[] + summary 全 0（不报错）', async () => {
    const res = await get('/api/records?from=2030-01-01&to=2030-01-31')
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
    expect(res.body.summary).toEqual({ total: 0, taken: 0, skipped: 0, later: 0 })
  })

  it('planId 悬空的孤儿记录：items 与 summary 同源，药名留痕不静默少一条（M5-T5d · 05d §7-6）', async () => {
    // DB 无外键（删药靠 services 显式级联），悬空行是真实可能出现的形态；
    // 修复前 listRecordsByRange 用 innerJoin 把它整行吞掉，而 summary 单表照计 → 页顶条数与列表差 1。
    const orphanPlan = 'plan-t6-orphan'
    const orphan = `${orphanPlan}__2026-09-12__08:00`
    await db.insert(records).values({
      id: orphan,
      userId: USER,
      planId: orphanPlan,
      scheduledDate: '2026-09-12',
      scheduledTime: '08:00',
      status: 'skipped',
    })
    try {
      const res = await get('/api/records?from=2026-09-01&to=2026-09-30')
      expect(res.status).toBe(200)
      expect(res.body.items.length).toBe(res.body.summary.total) // 断言型：两侧必须同源
      const row = res.body.items.find((r: { id: string }) => r.id === orphan)
      expect(row).toBeDefined()
      expect(row.drugName).toBe('（计划已删除）')
      expect(row.planId).toBe(orphanPlan)
    } finally {
      await db.delete(records).where(eq(records.id, orphan))
    }
  })
})

describe('GET /api/records · 入参校验', () => {
  it('日期格式非法 → 400 VALIDATION', async () => {
    const res = await get('/api/records?from=2026/09/01&to=2026-09-30')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION')
  })

  it('from 晚于 to → 400 VALIDATION', async () => {
    const res = await get('/api/records?from=2026-09-30&to=2026-09-01')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION')
  })

  it('缺 from/to → 400 VALIDATION', async () => {
    const res = await get('/api/records')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION')
  })
})
