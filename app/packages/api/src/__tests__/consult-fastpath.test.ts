/**
 * skillId 快路径 + 今日待服意图集成测试（M4-T7 · specs/04-T7）。
 *
 * 完成标准对照：
 * - skillId 快路径：正则不命中的自由写法与 skillId 命中走同一路径；
 * - next-dose golden 含边界（无生效计划 / 今日全服完 / 常态混合）；
 * - consult_logs.intent 断言更新（S2 快路径落解析后意图名；s1-insert 落快路径痕迹）；
 * - 自由文本正则路径逐字不变（对照组：同句无 skillId → 走 S1）；
 * - 未知 skillId → 400（不静默改道回正则）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { todayStr } from '@anxin/shared'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { consultLogs, drugMaster, drugs, plans, records } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients } from '../lib/ai/types.js'
import { mockClients } from './helpers/ai-mocks.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

const USER = 'p-001'
const DM = 'dm-fastpath-med'
const DRUG = 'drug-fastpath-med'
const PLAN = 'plan-fastpath'

let prevClients: AiClients | null = null

async function cleanup() {
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(records).where(eq(records.planId, PLAN))
  await db.delete(plans).where(eq(plans.id, PLAN))
  await db.delete(drugs).where(eq(drugs.id, DRUG))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM))
}

beforeAll(async () => {
  await cleanup()
  prevClients = setAiClients(mockClients({})) // 数据路径 0 LLM；S1 路径 mock 默认抛错（no-source 不触达）
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await cleanup()
})

beforeEach(async () => {
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(records).where(eq(records.planId, PLAN))
  await db.delete(plans).where(eq(plans.id, PLAN))
  await db.delete(drugs).where(eq(drugs.id, DRUG))
})

/** 建一支药 + 当日生效计划（08:00 / 20:00 两次）；master 跨用例保留（幂等插入）。 */
async function seedPlan() {
  await db
    .insert(drugMaster)
    .values({ id: DM, genericName: '快路径测试药', specification: '0.5g', form: '片剂' })
    .onConflictDoNothing()
  await db.insert(drugs).values({
    id: DRUG,
    userId: USER,
    genericName: '快路径测试药',
    specification: '0.5g',
    form: '片剂',
    drugMasterId: DM,
    confirmStatus: 'ocr_matched',
  })
  await db.insert(plans).values({
    id: PLAN,
    userId: USER,
    drugId: DRUG,
    dose: { value: 1, unit: '片' },
    frequency: 2,
    times: ['08:00', '20:00'],
    cycleType: 'open',
    startDate: todayStr(),
    status: 'active',
    source: 'manual',
  })
}

// ---------------------------------------------------------------------------
// skillId 快路径
// ---------------------------------------------------------------------------

describe('skillId 快路径（M4-T7）', () => {
  it('正则不命中的自由写法 + skillId → 与正则命中走同一路径（data-answered + toolUsed）', async () => {
    const res = await req('POST', '/api/consult', {
      question: '帮我看看我现在都吃哪些药哦',
      drugIds: [],
      skillId: 's2-medication-list',
    })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('data-answered')
    expect(res.body.toolUsed).toBe('medication-list')

    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs[0].intent).toBe('medication-list') // 落解析后的意图名（快路径与正则同构，供漏判统计）
  })

  it('对照组：同句无 skillId → 正则不命中 → 走 S1（自由文本正则路径逐字不变）', async () => {
    const res = await req('POST', '/api/consult', { question: '帮我看看我现在都吃哪些药哦', drugIds: [] })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('no-source')
    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs[0].intent).toBeNull()
  })

  it('s1-insert 显式直达 S1：即使问题会被正则路由到 S2（intent 落快路径痕迹）', async () => {
    const res = await req('POST', '/api/consult', {
      question: '我现在有多少药物',
      drugIds: [],
      skillId: 's1-insert',
    })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('no-source') // 未走数据直答
    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs[0].intent).toBe('s1-insert')
  })

  it('未知 skillId → 400 VALIDATION（不静默改道回正则）', async () => {
    const res = await req('POST', '/api/consult', {
      question: '我现在有多少药物',
      drugIds: [],
      skillId: 's2-bogus',
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION')
  })

  it('守门优先于快路径：L4 问句带 skillId 仍 emergency', async () => {
    const res = await req('POST', '/api/consult', {
      question: '我胸痛',
      drugIds: [],
      skillId: 's2-medication-list',
    })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('emergency')
  })
})

// ---------------------------------------------------------------------------
// next-dose（今日待服）三边界
// ---------------------------------------------------------------------------

describe('next-dose · 今日待服（M4-T7）', () => {
  it('常态混合：2 次安排已服 1 次 → 汇总 + 时间线 keyPoints + intent=next-dose', async () => {
    await seedPlan()
    await db.insert(records).values({
      id: 'rec-fastpath-taken',
      userId: USER,
      planId: PLAN,
      scheduledDate: todayStr(),
      scheduledTime: '08:00',
      status: 'taken',
    })

    const res = await req('POST', '/api/consult', { question: '今天我要吃哪些药', drugIds: [] })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('data-answered')
    expect(res.body.toolUsed).toBe('next-dose')
    expect(res.body.sections.summary).toContain('今天共 2 次服药安排')
    expect(res.body.sections.summary).toContain('已完成 1 次、待处理 1 次')
    expect(res.body.sections.summary).toContain('下一次是 20:00 的快路径测试药')
    expect(res.body.sections.keyPoints.join('')).toContain('08:00 快路径测试药 · 已服')
    expect(res.body.sections.keyPoints.join('')).toContain('20:00 快路径测试药 · 待服')
    // 剂量红线邻域：keyPoints 不含剂量数值
    expect(res.body.sections.keyPoints.join('')).not.toContain('1 片')

    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs[0].intent).toBe('next-dose') // 正则路径也落意图名
  })

  it('边界 · 今日全服完 → 「全部处理」文案（含跳过计数）', async () => {
    await seedPlan()
    await db.insert(records).values([
      { id: 'rec-fp-a', userId: USER, planId: PLAN, scheduledDate: todayStr(), scheduledTime: '08:00', status: 'taken' },
      { id: 'rec-fp-b', userId: USER, planId: PLAN, scheduledDate: todayStr(), scheduledTime: '20:00', status: 'skipped' },
    ])

    const res = await req('POST', '/api/consult', { question: '今天我要吃哪些药', drugIds: [] })
    expect(res.body.sections.summary).toContain('今天的服药已全部处理')
    expect(res.body.sections.summary).toContain('完成 1 次')
    expect(res.body.sections.summary).toContain('跳过 1 次')
    expect(res.body.sections.risks.join('')).toContain('漏服后不要自行加倍补服')
  })

  it('边界 · 无生效计划 → 「没有已安排的服药计划」友好文案', async () => {
    const res = await req('POST', '/api/consult', { question: '今天我要吃哪些药', drugIds: [] })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('data-answered')
    expect(res.body.toolUsed).toBe('next-dose')
    expect(res.body.sections.summary).toContain('你今天没有已安排的服药计划')
    expect(res.body.sections.nextAction).toContain('药箱')
  })
})
