/**
 * M3-T1 集成测试（app.request()，跑独立测试库）：POST /api/consult 完整链路。
 *
 * 完成标准（spec §T1）：
 * - 集成测试一条完整 L1 回答含合法 citations（三件套：药名 + source + version）
 * - AI 不可用 → AI_UNAVAILABLE 且不影响其他功能（降级 fallbackSectionsFromInsert）
 * - L4/L3/manual-gate 触发 → risk_events 留痕（供 M3-T3 医生端消费）
 * - 用户提问含 PII → 落库前脱敏（zero-leak 断言）
 *
 * 测试库 globalSetup 只 seed users（无资产域数据），故本文件自建 fixture，afterAll 清理。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import {
  consultLogs,
  drugMaster,
  drugs,
  packageInserts,
  plans,
  riskEvents,
} from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import { AIUnavailableError, type AiClients } from '../lib/ai/types.js'
import { mockClients, newCalls } from './helpers/ai-mocks.js'
import { findPii } from '../services/sanitize/log.js'

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
const DM_HYCOSAN = 'dm-t1-hycosan'
const DRUG_HYCOSAN = 'drug-t1-hycosan'
const DRUG_MANUAL = 'drug-t1-manual'
const DRUG_NO_INSERT = 'drug-t1-no-insert'
const PI_HYCOSAN = 'pi-t1-hycosan'
const PLAN_HYCOSAN = 'plan-t1-hycosan'

let prevClients: AiClients | null = null

beforeAll(async () => {
  // 清空 p-001 既有数据，保证 fixture 确定性
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))

  // 资产域：drug_master + package_inserts（海露 0.1%）
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
    precautions: ['开封后一个月内使用', '避免瓶口接触眼睛或皮肤'],
    interactions: '尚无明确相互作用资料',
    pharmacology: '玻璃酸钠为天然存在的多糖，具有保湿和润滑作用',
    pharmacokinetics: '局部用药，几乎不吸收入血',
    storage: '密封，避光，不超过25℃保存',
    source: '丁香园用药助手（演示抄录）',
    version: '2024-01',
  })

  // 用户域：3 支药（ocr_matched 有 insert / manual 无 masterId / ocr_matched 无 insert）
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
      id: DRUG_MANUAL,
      userId: USER,
      genericName: '手动建档的测试药',
      drugMasterId: null,
      confirmStatus: 'manual',
    },
    {
      id: DRUG_NO_INSERT,
      userId: USER,
      genericName: ' library 未收录的药',
      drugMasterId: 'dm-not-exist',
      confirmStatus: 'ocr_matched',
    },
  ])

  // 生效计划（供相互作用上下文注入）
  await db.insert(plans).values({
    id: PLAN_HYCOSAN,
    userId: USER,
    drugId: DRUG_HYCOSAN,
    dose: { value: 1, unit: '滴' },
    frequency: 4,
    times: ['08:00', '12:00', '16:00', '20:00'],
    cycleType: 'open',
    startDate: '2026-09-01',
    status: 'active',
    source: 'manual',
  })
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(plans).where(inArray(plans.id, [PLAN_HYCOSAN]))
  await db.delete(drugs).where(inArray(drugs.id, [DRUG_HYCOSAN, DRUG_MANUAL, DRUG_NO_INSERT]))
  await db.delete(packageInserts).where(eq(packageInserts.id, PI_HYCOSAN))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM_HYCOSAN))
})

beforeEach(async () => {
  // 每个测试前清空留痕表，保证断言确定性
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
})

// ---------------------------------------------------------------------------
// L1 完整回答（citations 三件套）
// ---------------------------------------------------------------------------

describe('POST /api/consult · L1 完整回答（PRD §7.5）', () => {
  it('正常咨询 + mock LLM 干净输出 → 200 + citations 三件套 + consult_logs 留痕', async () => {
    const calls = newCalls()
    prevClients = setAiClients(
      mockClients({
        calls,
        consult: {
          summary: '玻璃酸钠滴眼液用于缓解干眼症状',
          keyPoints: ['保湿润滑作用', '局部用药几乎不吸收'],
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
    expect(res.body.ok).toBe(true)
    expect(res.body.riskLevel).toBe('L1')
    expect(res.body.status).toBe('answered')
    expect(res.body.answer).toContain('缓解干眼症状')
    expect(res.body.blocked).toBe(false)

    // citations 三件套（PRD §7.5 硬约束）
    expect(res.body.citations).toHaveLength(1)
    expect(res.body.citations[0]).toMatchObject({
      drugName: '玻璃酸钠滴眼液',
      source: '丁香园用药助手（演示抄录）',
      version: '2024-01',
      unverified: false,
    })

    // sections 结构化
    expect(res.body.sections.summary).toContain('缓解干眼症状')
    expect(res.body.sections.keyPoints.length).toBeGreaterThan(0)

    // consultAnswer 被调用（mock 计数）
    expect(calls.consultAnswer).toBe(1)

    // consult_logs 留痕
    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs).toHaveLength(1)
    expect(logs[0].riskLevel).toBe('L1')
    expect(logs[0].status).toBe('answered')
    expect(logs[0].blockedAt).toBeNull()

    // L1 不触发 risk_events
    const events = await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// L4 紧急信号
// ---------------------------------------------------------------------------

describe('POST /api/consult · L4 紧急信号（PRD §7.5.1）', () => {
  it('"我胸痛" → L4 + blocked + risk_events 留痕（level=L4, type=emergency）', async () => {
    prevClients = setAiClients(mockClients({}))

    const res = await req('POST', '/api/consult', {
      question: '我胸痛得厉害，怎么办',
      drugIds: [DRUG_HYCOSAN],
    })

    expect(res.status).toBe(200)
    expect(res.body.riskLevel).toBe('L4')
    expect(res.body.status).toBe('emergency')
    expect(res.body.blocked).toBe(true)
    expect(res.body.answer).toContain('紧急处理')
    expect(res.body.sections.nextAction).toContain('急救电话')

    // risk_events 留痕
    const events = await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))
    expect(events).toHaveLength(1)
    expect(events[0].level).toBe('L4')
    expect(events[0].type).toBe('emergency')
    expect((events[0].detail as any).matchedKeyword).toBe('胸痛')

    // consult_logs 留痕（blockedAt=L4）
    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs[0].blockedAt).toBe('L4')
  })
})

// ---------------------------------------------------------------------------
// L3 拒答
// ---------------------------------------------------------------------------

describe('POST /api/consult · L3 拒答（PRD §7.5.2）', () => {
  it('"能不能停药" → L3 + blocked + risk_events 留痕（level=L3, type=refused）', async () => {
    prevClients = setAiClients(mockClients({}))

    const res = await req('POST', '/api/consult', {
      question: '这个药能不能停',
      drugIds: [DRUG_HYCOSAN],
    })

    expect(res.status).toBe(200)
    expect(res.body.riskLevel).toBe('L3')
    expect(res.body.status).toBe('refused')
    expect(res.body.blocked).toBe(true)
    expect(res.body.sections.nextAction).toContain('医生或药师')

    const events = await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))
    expect(events).toHaveLength(1)
    expect(events[0].level).toBe('L3')
    expect(events[0].type).toBe('refused')
  })
})

// ---------------------------------------------------------------------------
// manual 档门禁
// ---------------------------------------------------------------------------

describe('POST /api/consult · manual 档门禁（PRD §7.5.4）', () => {
  it('manual 档药 + 无 insert → manual-gate + l0Notice + risk_events 留痕', async () => {
    prevClients = setAiClients(mockClients({}))

    const res = await req('POST', '/api/consult', {
      question: '这个药通常用于什么',
      drugIds: [DRUG_MANUAL],
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('manual-gate')
    expect(res.body.blocked).toBe(true)
    expect(res.body.l0Notice).toContain('手动建档')
    expect(res.body.l0Notice).toContain('L0')

    const events = await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))
    expect(events).toHaveLength(1)
    expect(events[0].level).toBe('manual-gate')
    expect(events[0].type).toBe('manual-blocked')
  })
})

// ---------------------------------------------------------------------------
// no-source（本地未命中）
// ---------------------------------------------------------------------------

describe('POST /api/consult · no-source（本地说明书库未命中）', () => {
  it('药有 masterId 但 library 无 insert → no-source 固定文案', async () => {
    prevClients = setAiClients(mockClients({}))

    const res = await req('POST', '/api/consult', {
      question: '这个药通常用于什么',
      drugIds: [DRUG_NO_INSERT],
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('no-source')
    expect(res.body.answer).toContain('本地说明书库未收录')
    expect(res.body.citations).toEqual([])
    // 默认 ENABLE_MEDICAL_SEARCH=false → notice 提示正式版会开兜底
    expect(res.body.notice).toContain('医疗搜索')
  })
})

// ---------------------------------------------------------------------------
// AI 不可用降级
// ---------------------------------------------------------------------------

describe('POST /api/consult · AI 不可用降级（PRD §7.5 / spec §T1 完成标准）', () => {
  it('Baichuan 抛 AIUnavailableError → 降级 fallbackSectionsFromInsert + notice 说明', async () => {
    prevClients = setAiClients(
      mockClients({
        consultAnswerError: new AIUnavailableError('baichuan', '模拟服务不可用'),
      }),
    )

    const res = await req('POST', '/api/consult', {
      question: '这个药通常用于什么？',
      drugIds: [DRUG_HYCOSAN],
    })

    expect(res.status).toBe(200) // 降级不炸整体
    expect(res.body.riskLevel).toBe('L1')
    expect(res.body.status).toBe('answered')
    expect(res.body.notice).toContain('百川服务不可用')
    expect(res.body.notice).toContain('本地说明书库规则拼装')
    // citations 仍三件套齐备（降级路径也用本地说明书）
    expect(res.body.citations[0]).toMatchObject({
      drugName: '玻璃酸钠滴眼液',
      source: '丁香园用药助手（演示抄录）',
    })
    // 回答内容来自说明书段落（不是 LLM 生成）
    expect(res.body.answer).toContain('缓解干眼症状')
  })
})

// ---------------------------------------------------------------------------
// L2 剂量过滤
// ---------------------------------------------------------------------------

describe('POST /api/consult · L2 剂量过滤（PRD §7.5.3）', () => {
  it('LLM 输出含剂量（stripDosageAdvice 切不干净的变体）→ limited=true → riskLevel=L2 + notice 固定提示', async () => {
    prevClients = setAiClients(
      mockClients({
        consult: {
          // "每日使用超过10次" 命中 DOSAGE_OUTPUT_PATTERN 但 stripDosageAdvice 切不干净（切除正则不含"每日"）
          summary: '每日使用超过10次需咨询医生',
          keyPoints: ['保湿作用'],
          risks: [],
          nextAction: '按医嘱使用',
          warning: '不要自行调整',
        },
      }),
    )

    const res = await req('POST', '/api/consult', {
      question: '这个药怎么用',
      drugIds: [DRUG_HYCOSAN],
    })

    expect(res.status).toBe(200)
    expect(res.body.riskLevel).toBe('L2')
    expect(res.body.status).toBe('limited')
    expect(res.body.notice).toContain('已过滤具体剂量建议')
    expect(res.body.sections.nextAction).toBe('具体用量和疗程请按医生处方或说明书执行。')
  })
})

// ---------------------------------------------------------------------------
// 零泄漏断言（PII 脱敏）
// ---------------------------------------------------------------------------

describe('POST /api/consult · 零泄漏断言（L3 出口约束）', () => {
  it('用户提问含手机号 → 落库前脱敏（consult_logs.question 不含原文）', async () => {
    prevClients = setAiClients(mockClients({ consult: { summary: '回答' } }))

    const res = await req('POST', '/api/consult', {
      question: '我的手机号是13812345678，这个药通常用于什么？',
      drugIds: [DRUG_HYCOSAN],
    })

    expect(res.status).toBe(200)

    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs).toHaveLength(1)
    // 落库的 question 不含原文手机号
    expect(logs[0].question).not.toContain('13812345678')
    expect(logs[0].question).toContain('[已脱敏]')
    // 零泄漏断言：findPii 对落库文本返回空
    expect(findPii(logs[0].question)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 入参校验
// ---------------------------------------------------------------------------

describe('POST /api/consult · 入参校验', () => {
  it('空 question → 400 VALIDATION', async () => {
    const res = await req('POST', '/api/consult', { question: '', drugIds: [] })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION')
  })

  it('缺 question 字段 → 400 VALIDATION', async () => {
    const res = await req('POST', '/api/consult', { drugIds: [] })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION')
  })
})
