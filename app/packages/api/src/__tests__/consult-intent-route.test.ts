/**
 * AI 药师意图路由 · service 层接线集成测试（计划 T4）。
 *
 * 为什么新建本文件而非扩展 consult-dataquery.test.ts：
 * - consult-dataquery.test.ts 是「工具/模板」层测试，直调 runDataQuery，用独立 userId（p-dq-001）；
 * - 本文件是「HTTP 编排」层测试，走 app.request() → resolveUser 中间件**固定注入 p-001**，
 *   断言 consult_logs/risk_events 落库与 AiClients 调用计数（与 consult-api.test.ts 同一套骨架）。
 *   两者 userId 与生命周期不同（本文件需自建资产域 fixture 并在 afterAll 精确清理），
 *   混在一个文件会 entangle 两套 beforeAll/afterAll，故按现有「一文件一关注点」习惯独立成文。
 *
 * 覆盖点（对应任务 T4 §3）：
 *   (a) 无药 drugIds=[] + 数据问题 → 200 + data-answered + DB 来源 citations + consult_logs 落库
 *       + mock consultAnswer 零调用；
 *   (b) 守门优先：混合句「胸痛 + 查药」→ emergency（L4）、「停药 + 查药」→ refused（L3）；
 *   (c) 说明书问题行为不变（走原 run.ts 管线，status=answered，consultAnswer 调用 1 次）；
 *   (d) ENABLE_INTENT_ROUTE=false 回退：数据问题走原管线（无药 → no-source 兜底），非 data-answered；
 *   (e) interaction-check：「一起吃有冲突吗」→ data-answered + toolUsed=interaction-check。
 *
 * ⚠️ resolveUser 中间件对所有 /api/* 固定注入演示用户 p-001，故本文件 fixture 全部挂 p-001；
 *    资产域（drug_master/package_inserts/interaction_rules）用 ir- 前缀独立 id，afterAll 精确清理。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { todayStr, addDaysStr } from '@anxin/shared'
import { app } from '../app.js'
import { db } from '../db/client.js'
import {
  consultLogs,
  drugMaster,
  drugs,
  interactionRules,
  packageInserts,
  plans,
  riskEvents,
} from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients } from '../lib/ai/types.js'
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

const USER = 'p-001' // resolveUser 中间件固定注入的演示用户

// 资产域 fixture id（ir- 前缀，避免与 consult-api.test.ts 的 t1- 前缀冲突）
const DM_HYCOSAN = 'dm-ir-hycosan'
const PI_HYCOSAN = 'pi-ir-hycosan'
const DM_A = 'dm-ir-warfarin'
const DM_B = 'dm-ir-aspirin'
const IR_AB = 'ir-ir-warfarin-aspirin'

// 用户域 fixture id
const DRUG_HYCOSAN = 'drug-ir-hycosan'
const DRUG_A = 'drug-ir-warfarin'
const DRUG_B = 'drug-ir-aspirin'
const PLAN_A = 'plan-ir-warfarin'
const PLAN_B = 'plan-ir-aspirin'

let prevClients: AiClients | null = null
let prevIntentRoute: string | undefined

beforeAll(async () => {
  prevIntentRoute = process.env.ENABLE_INTENT_ROUTE
  const today = todayStr()

  // 清空 p-001 既有数据，保证 fixture 确定性（与 consult-api.test.ts 同款纪律）
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))
  // 清理可能的资产域残留（重跑幂等）
  await db.delete(interactionRules).where(eq(interactionRules.id, IR_AB))
  await db.delete(packageInserts).where(eq(packageInserts.id, PI_HYCOSAN))
  await db.delete(drugMaster).where(inArray(drugMaster.id, [DM_HYCOSAN, DM_A, DM_B]))

  // 资产域：说明书药（海露）—— 供 (c) 说明书问题走原管线
  await db.insert(drugMaster).values({
    id: DM_HYCOSAN,
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%（10mL:10mg）',
    form: '滴眼液',
  })
  await db.insert(packageInserts).values({
    id: PI_HYCOSAN,
    drugId: DM_HYCOSAN,
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%（10mL:10mg）',
    form: '滴眼液',
    indication: '用于缓解干眼症状，如眼睛干涩、异物感、疲劳等',
    components: '玻璃酸钠',
    dosage: { adult: { dosePerUse: { value: 1, unit: '滴' }, maxFrequencyPerDay: { value: 10, unit: '次' } } },
    contraindications: ['对玻璃酸钠过敏者禁用'],
    adverseReactions: '偶见眼部刺激感、异物感',
    precautions: ['开封后一个月内使用'],
    interactions: '尚无明确相互作用资料',
    pharmacology: '玻璃酸钠为天然存在的多糖，具有保湿和润滑作用',
    storage: '密封，避光，不超过25℃保存',
    source: '丁香园用药助手（演示抄录）',
    version: '2024-01',
  })

  // 资产域：相互作用对（华法林 + 阿司匹林，禁忌级）—— 供 (e) interaction-check 命中
  await db.insert(drugMaster).values([
    { id: DM_A, genericName: '华法林钠片', specification: '2.5mg', form: '片剂' },
    { id: DM_B, genericName: '阿司匹林肠溶片', specification: '100mg', form: '片剂' },
  ])
  await db.insert(interactionRules).values({
    id: IR_AB,
    drugIds: [DM_A, DM_B],
    level: '禁忌',
    note: '华法林与阿司匹林联用出血风险升高（测试抄录）',
    source: '测试规则库',
  })

  // 用户域：3 支药（说明书药 + 相互作用对，均 ocr_matched 带 masterId）
  await db.insert(drugs).values([
    {
      id: DRUG_HYCOSAN,
      userId: USER,
      genericName: '玻璃酸钠滴眼液',
      brandName: '海露',
      specification: '0.1%',
      form: '滴眼液',
      drugMasterId: DM_HYCOSAN,
      confirmStatus: 'ocr_matched',
    },
    {
      id: DRUG_A,
      userId: USER,
      genericName: '华法林钠片',
      specification: '2.5mg',
      form: '片剂',
      drugMasterId: DM_A,
      confirmStatus: 'ocr_matched',
    },
    {
      id: DRUG_B,
      userId: USER,
      genericName: '阿司匹林肠溶片',
      specification: '100mg',
      form: '片剂',
      drugMasterId: DM_B,
      confirmStatus: 'ocr_matched',
    },
  ])

  // 生效计划（相互作用对两药均 active，使 resolveActiveMasterIds 返回 ≥2 个 masterId）
  await db.insert(plans).values([
    {
      id: PLAN_A,
      userId: USER,
      drugId: DRUG_A,
      dose: { value: 1, unit: '片' },
      frequency: 1,
      times: ['08:00'],
      cycleType: 'open',
      startDate: addDaysStr(today, -7),
      status: 'active',
      source: 'manual',
    },
    {
      id: PLAN_B,
      userId: USER,
      drugId: DRUG_B,
      dose: { value: 1, unit: '片' },
      frequency: 1,
      times: ['08:00'],
      cycleType: 'open',
      startDate: addDaysStr(today, -7),
      status: 'active',
      source: 'manual',
    },
  ])
})

afterAll(async () => {
  // 恢复 env（(d) 用例改过 ENABLE_INTENT_ROUTE）与 AI 客户端
  if (prevIntentRoute === undefined) delete process.env.ENABLE_INTENT_ROUTE
  else process.env.ENABLE_INTENT_ROUTE = prevIntentRoute
  if (prevClients) setAiClients(prevClients)

  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(plans).where(inArray(plans.id, [PLAN_A, PLAN_B]))
  await db.delete(drugs).where(inArray(drugs.id, [DRUG_HYCOSAN, DRUG_A, DRUG_B]))
  await db.delete(interactionRules).where(eq(interactionRules.id, IR_AB))
  await db.delete(packageInserts).where(eq(packageInserts.id, PI_HYCOSAN))
  await db.delete(drugMaster).where(inArray(drugMaster.id, [DM_HYCOSAN, DM_A, DM_B]))
})

beforeEach(async () => {
  // 每个用例前清空留痕表，保证落库断言确定性
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
})

// ---------------------------------------------------------------------------
// (a) 无药 + 数据问题 → data-answered + DB citation + 落库 + LLM 零调用
// ---------------------------------------------------------------------------

describe('意图路由 · (a) 数据查询直答（无药上下文）', () => {
  it('drugIds=[] +「我现在有多少药物」→ 200 + data-answered + DB 来源 citations + 落库 + consultAnswer 零调用', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '我现在有多少药物',
      drugIds: [],
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.status).toBe('data-answered')
    expect(res.body.riskLevel).toBe('L1')
    expect(res.body.blocked).toBe(false)
    expect(res.body.toolUsed).toBe('medication-list')

    // citations 含 DB 来源三件套（drugName/source/version + unverified=false）
    expect(res.body.citations).toHaveLength(1)
    expect(res.body.citations[0]).toMatchObject({
      drugName: '我的用药数据',
      unverified: false,
    })
    expect(res.body.citations[0].source).toContain('本地数据库')
    expect(typeof res.body.citations[0].version).toBe('string')

    // 清单含自建药名
    expect(res.body.sections.keyPoints.join('')).toContain('华法林钠片')

    // 关键结构红线：数据查询路径 0 次 LLM 调用
    expect(calls.consultAnswer).toBe(0)

    // consult_logs 落一行 status=data-answered，blockedAt=null，不进 risk_events
    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe('data-answered')
    expect(logs[0].riskLevel).toBe('L1')
    expect(logs[0].blockedAt).toBeNull()
    const events = await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// (b) 守门优先于意图路由
// ---------------------------------------------------------------------------

describe('意图路由 · (b) 守门优先（L4/L3 先于意图）', () => {
  it('「我胸痛，还有多少药」→ emergency（L4 优先，不被数据查询意图截胡）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '我胸痛，还有多少药',
      drugIds: [],
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('emergency')
    expect(res.body.riskLevel).toBe('L4')
    expect(res.body.blocked).toBe(true)
    expect(res.body.toolUsed).toBeNull()
    // L4 留痕
    const events = await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))
    expect(events).toHaveLength(1)
    expect(events[0].level).toBe('L4')
    expect(events[0].type).toBe('emergency')
  })

  it('「我想停药，我有多少药」→ refused（L3 优先）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '我想停药，我有多少药',
      drugIds: [],
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('refused')
    expect(res.body.riskLevel).toBe('L3')
    expect(res.body.blocked).toBe(true)
    expect(res.body.toolUsed).toBeNull()
    const events = await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))
    expect(events).toHaveLength(1)
    expect(events[0].level).toBe('L3')
    expect(events[0].type).toBe('refused')
  })
})

// ---------------------------------------------------------------------------
// (c) 说明书问题行为不变（走原 run.ts 管线）
// ---------------------------------------------------------------------------

describe('意图路由 · (c) 说明书问题行为不变', () => {
  it('选说明书药 +「这个药通常用于什么？」→ answered（原管线，consultAnswer 调用 1 次）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(
      mockClients({
        calls,
        consult: {
          summary: '玻璃酸钠滴眼液用于缓解干眼症状',
          keyPoints: ['保湿润滑作用'],
          risks: ['偶见眼部刺激感'],
          nextAction: '如症状持续请咨询眼科医生',
          warning: '不要自行调整处方',
        },
      }),
    )

    const res = await req('POST', '/api/consult', {
      question: '这个药通常用于什么？',
      drugIds: [DRUG_HYCOSAN],
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('answered')
    expect(res.body.riskLevel).toBe('L1')
    expect(res.body.toolUsed).toBeNull() // 非数据查询路径不带 toolUsed
    // citations 走本地说明书三件套（非 DB 数据引用）
    expect(res.body.citations[0]).toMatchObject({
      drugName: '玻璃酸钠滴眼液',
      source: '丁香园用药助手（演示抄录）',
      version: '2024-01',
      unverified: false,
    })
    // 走原 LLM 管线：consultAnswer 被调用 1 次
    expect(calls.consultAnswer).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// (d) 灰度开关回退（ENABLE_INTENT_ROUTE=false）
// ---------------------------------------------------------------------------

describe('意图路由 · (d) 开关回退旧行为', () => {
  it('ENABLE_INTENT_ROUTE=false + 数据问题 → 走原管线（no-source 兜底），非 data-answered', async () => {
    process.env.ENABLE_INTENT_ROUTE = 'false'
    try {
      const calls = newCalls()
      prevClients = setAiClients(mockClients({ calls }))

      const res = await req('POST', '/api/consult', {
        question: '我现在有多少药物',
        drugIds: [],
      })

      expect(res.status).toBe(200)
      // 开关关：不进意图路由 → run.ts 无药上下文 proceed 兜底为 no-source 固定文案
      expect(res.body.status).not.toBe('data-answered')
      expect(res.body.status).toBe('no-source')
      expect(res.body.toolUsed).toBeNull()
      expect(res.body.answer).toContain('本地说明书库未收录')
    } finally {
      // 恢复 env，避免污染后续用例
      if (prevIntentRoute === undefined) delete process.env.ENABLE_INTENT_ROUTE
      else process.env.ENABLE_INTENT_ROUTE = prevIntentRoute
    }
  })
})

// ---------------------------------------------------------------------------
// (e) interaction-check 意图
// ---------------------------------------------------------------------------

describe('意图路由 · (e) 相互作用检查', () => {
  it('「我的药一起吃有冲突吗」→ data-answered + toolUsed=interaction-check + 命中禁忌规则', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '我的药一起吃有冲突吗',
      drugIds: [],
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('data-answered')
    expect(res.body.toolUsed).toBe('interaction-check')
    expect(res.body.citations[0].source).toContain('本地数据库')
    // 命中华法林 + 阿司匹林禁忌规则（分级 + 药名展示）
    expect(res.body.sections.summary).toContain('相互作用提示')
    expect(res.body.sections.keyPoints.join('')).toContain('禁忌')
    expect(res.body.sections.keyPoints.join('')).toContain('华法林钠片')
    // 0 次 LLM 调用
    expect(calls.consultAnswer).toBe(0)
  })
})
