/**
 * M3-T3 集成测试（app.request()，跑独立测试库）：GET /api/insight/patients + POST /api/insight/summary。
 *
 * 完成标准（spec §T3）：
 * - 与 mock 数据等价的 seed 入库后，医生端三屏（列表/详情/摘要）数据来自 DB
 * - 摘要生成有单测（数据组装部分，LLM mock）
 * - 演示患者 p-001 数据正确显示
 *
 * 测试库 globalSetup 只 seed users（p-001），故本文件自建 fixture，afterAll 清理。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { drugs, healthProfiles, plans, records, riskEvents, consultLogs } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import { AIUnavailableError, type AiClients } from '../lib/ai/types.js'
import { mockClients, newCalls } from './helpers/ai-mocks.js'

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
const DRUG_AMLO = 'drug-t3-amlo'
const DRUG_METF = 'drug-t3-metf'
const PLAN_AMLO = 'plan-t3-amlo'
const PLAN_METF = 'plan-t3-metf'
const HEALTH_GENDER = 'health-t3-gender'
const HEALTH_AGE = 'health-t3-age'
const HEALTH_COND = 'health-t3-cond'

let prevClients: AiClients | null = null

beforeAll(async () => {
  // 清空 p-001 既有数据
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(records).where(eq(records.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))
  await db.delete(healthProfiles).where(eq(healthProfiles.userId, USER))

  // 健康信息（性别/年龄/诊断）
  await db.insert(healthProfiles).values([
    { id: HEALTH_GENDER, userId: USER, fieldKey: '性别', value: '男' },
    { id: HEALTH_AGE, userId: USER, fieldKey: '年龄', value: '68' },
    { id: HEALTH_COND, userId: USER, fieldKey: '诊断', value: '高血压、2型糖尿病' },
  ])

  // 药箱 2 支药（手动建档，drugMasterId=null）
  await db.insert(drugs).values([
    {
      id: DRUG_AMLO,
      userId: USER,
      genericName: '苯磺酸氨氯地平片',
      specification: '5mg',
      form: '片剂',
      drugMasterId: null,
      confirmStatus: 'manual',
      stock: { value: 30, unit: '片' },
      expiry: '2027-03-01',
    },
    {
      id: DRUG_METF,
      userId: USER,
      genericName: '盐酸二甲双胍片',
      specification: '0.5g',
      form: '片剂',
      drugMasterId: null,
      confirmStatus: 'manual',
      stock: { value: 8, unit: '片' }, // 低库存
      expiry: '2026-09-20', // 临期
    },
  ])

  // 2 个 active 计划
  const today = new Date().toISOString().slice(0, 10)
  await db.insert(plans).values([
    {
      id: PLAN_AMLO,
      userId: USER,
      drugId: DRUG_AMLO,
      dose: { value: 1, unit: '片' },
      frequency: 1,
      times: ['08:00'],
      cycleType: 'open',
      startDate: today,
      status: 'active',
      source: 'manual',
    },
    {
      id: PLAN_METF,
      userId: USER,
      drugId: DRUG_METF,
      dose: { value: 1, unit: '片' },
      frequency: 2,
      times: ['08:00', '19:00'],
      cycleType: 'open',
      startDate: today,
      status: 'active',
      source: 'manual',
    },
  ])

  // 最近 7 天 records（部分 taken / 部分 skipped）
  const recRows: any[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    recRows.push({
      id: `${PLAN_AMLO}__${dateStr}__08:00`,
      userId: USER,
      planId: PLAN_AMLO,
      scheduledDate: dateStr,
      scheduledTime: '08:00',
      status: i < 3 ? 'taken' : 'skipped', // 最近 3 天 taken，之前 skipped
    })
  }
  await db.insert(records).values(recRows)
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(records).where(eq(records.userId, USER))
  await db.delete(plans).where(inArray(plans.id, [PLAN_AMLO, PLAN_METF]))
  await db.delete(drugs).where(inArray(drugs.id, [DRUG_AMLO, DRUG_METF]))
  await db.delete(healthProfiles).where(inArray(healthProfiles.id, [HEALTH_GENDER, HEALTH_AGE, HEALTH_COND]))
})

beforeEach(async () => {
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
})

// ---------------------------------------------------------------------------
// GET /api/insight/patients
// ---------------------------------------------------------------------------

describe('GET /api/insight/patients · 患者列表（spec §T3.2）', () => {
  it('返回 p-001 演示患者 + 概要（age/gender/conditions/drugCount）', async () => {
    const res = await req('GET', '/api/insight/patients')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(Array.isArray(res.body.items)).toBe(true)

    const p001 = res.body.items.find((p: any) => p.id === USER)
    expect(p001).toBeTruthy()
    expect(p001.name).toBe('张某某')
    expect(p001.age).toBe(68)
    expect(p001.gender).toBe('男')
    expect(p001.conditions).toEqual(['高血压', '2型糖尿病'])
    expect(p001.drugCount).toBe(2) // 2 个 active 计划
  })
})

// ---------------------------------------------------------------------------
// POST /api/insight/summary
// ---------------------------------------------------------------------------

describe('POST /api/insight/summary · 摘要生成（spec §T3.3）', () => {
  it('mock LLM 干净输出 → 200 + sections 结构化 + tools 5 类数据 + snapshot.mode=llm', async () => {
    const calls = newCalls()
    prevClients = setAiClients(
      mockClients({
        calls,
        insight: {
          summary: '患者执行率良好',
          keyPoints: ['连续漏服 0 次', '未见相互作用'],
          risks: ['临期药品需确认'],
          nextAction: '诊间确认漏服原因',
          warning: '本摘要仅供参考',
        },
      }),
    )

    // 临时设 BAICHUAN_API_KEY 让 service 走 LLM 路径
    const origKey = process.env.BAICHUAN_API_KEY
    process.env.BAICHUAN_API_KEY = 'test-key'
    try {
      const res = await req('POST', '/api/insight/summary', { patientId: USER })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.riskLevel).toBe('L1')
      expect(res.body.sections.summary).toBe('患者执行率良好')
      expect(res.body.snapshot.mode).toBe('llm')
      expect(res.body.snapshot.toolChain).toHaveLength(5)

      // tools 5 类数据
      expect(res.body.tools.adherence).toBeTruthy()
      expect(res.body.tools.adherence.rate).toBeGreaterThanOrEqual(0)
      expect(res.body.tools.medicationList).toHaveLength(2)
      expect(res.body.tools.interactions).toBeTruthy()
      expect(res.body.tools.expiry).toBeTruthy()
      expect(res.body.tools.riskEvents).toBeTruthy()

      // insightSummary 被调用
      expect(calls.insightSummary).toBe(1)
    } finally {
      if (origKey === undefined) delete process.env.BAICHUAN_API_KEY
      else process.env.BAICHUAN_API_KEY = origKey
    }
  })

  it('无 BAICHUAN_API_KEY → 离线降级（snapshot.mode=offline-fallback）', async () => {
    const origKey = process.env.BAICHUAN_API_KEY
    delete process.env.BAICHUAN_API_KEY
    try {
      const res = await req('POST', '/api/insight/summary', { patientId: USER })
      expect(res.status).toBe(200)
      expect(res.body.snapshot.mode).toBe('offline-fallback')
      expect(res.body.notice).toContain('未配置 BAICHUAN_API_KEY')
      // 降级摘要仍含患者信息
      expect(res.body.sections.summary).toContain('张某某')
    } finally {
      if (origKey !== undefined) process.env.BAICHUAN_API_KEY = origKey
    }
  })

  it('LLM 抛 AIUnavailableError → 错误降级（snapshot.mode=error-fallback）', async () => {
    prevClients = setAiClients(
      mockClients({
        insightSummaryError: new AIUnavailableError('baichuan', '模拟服务不可用'),
      }),
    )

    const origKey = process.env.BAICHUAN_API_KEY
    process.env.BAICHUAN_API_KEY = 'test-key'
    try {
      const res = await req('POST', '/api/insight/summary', { patientId: USER })
      expect(res.status).toBe(200)
      expect(res.body.snapshot.mode).toBe('error-fallback')
      expect(res.body.notice).toContain('LLM 调用失败')
    } finally {
      if (origKey === undefined) delete process.env.BAICHUAN_API_KEY
      else process.env.BAICHUAN_API_KEY = origKey
    }
  })

  it('LLM 输出含 L4 关键词 → guardSummary 二次守门 → riskLevel=L4', async () => {
    prevClients = setAiClients(
      mockClients({
        insight: {
          summary: '患者主诉胸痛，需紧急处理',
          keyPoints: [],
          risks: [],
          nextAction: '',
          warning: '',
        },
      }),
    )

    const origKey = process.env.BAICHUAN_API_KEY
    process.env.BAICHUAN_API_KEY = 'test-key'
    try {
      const res = await req('POST', '/api/insight/summary', { patientId: USER })
      expect(res.status).toBe(200)
      expect(res.body.riskLevel).toBe('L4')
      expect(res.body.sections.summary).toContain('紧急风险信号')
    } finally {
      if (origKey === undefined) delete process.env.BAICHUAN_API_KEY
      else process.env.BAICHUAN_API_KEY = origKey
    }
  })

  it('patientId 不存在 → 404 NOT_FOUND', async () => {
    const res = await req('POST', '/api/insight/summary', { patientId: 'not-exist' })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  it('缺 patientId → 400 VALIDATION', async () => {
    const res = await req('POST', '/api/insight/summary', {})
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION')
  })
})

// ---------------------------------------------------------------------------
// 风险事件流（消费 M3-T1 的 risk_events + consult_logs）
// ---------------------------------------------------------------------------

describe('POST /api/insight/summary · 风险事件流（spec §T3.1）', () => {
  it('有 risk_events → tools.riskEvents.events 非空 + hasL4/hasL3 正确', async () => {
    // 先触发一次 L4 咨询（写 risk_events）
    prevClients = setAiClients(mockClients({}))
    await req('POST', '/api/consult', { question: '我胸痛', drugIds: [] })

    // 再生成摘要
    const origKey = process.env.BAICHUAN_API_KEY
    delete process.env.BAICHUAN_API_KEY
    try {
      const res = await req('POST', '/api/insight/summary', { patientId: USER })
      expect(res.status).toBe(200)
      expect(res.body.tools.riskEvents.events.length).toBeGreaterThan(0)
      expect(res.body.tools.riskEvents.hasL4).toBe(true)
      expect(res.body.tools.riskEvents.consultCount).toBeGreaterThan(0)
    } finally {
      if (origKey !== undefined) process.env.BAICHUAN_API_KEY = origKey
    }
  })
})
