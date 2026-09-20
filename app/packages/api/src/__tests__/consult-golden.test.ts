/**
 * 咨询不变量 golden（M4-T2 · specs/04-T2）——断言「契约面」而非逐字节内容，不随 prompt 演进漂移。
 *
 * 四类不变量（任务书 T2）：
 *   ① 响应结构：ConsultResponseSchema 全字段 + consultLogId（shared 契约的面）；
 *   ② 守门行为：L4/L3/limited 各 ≥3 口语变体全拦截/全过滤（静态保证拦截召回）；
 *   ③ 非拦截回答 citations 三件套非空（answered / data-answered / 降级拼装三路径）；
 *   ④ 降级语义：AI_UNAVAILABLE → 说明书规则拼装 + notice，仍 200（不炸整体、不静默）。
 *
 * 与 consult-api.test.ts 的分工：那边是 M3-T1 功能验收（逐行为），本文件是行为变更任务
 * （T3–T9）的安全网——重构/改 prompt 后先跑这里，绿了才允许动行为。
 *
 * 测试库 globalSetup 只 seed users，本文件自建 fixture（dm-golden 系），afterAll 清理。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { consultLogs, drugMaster, drugs, packageInserts, plans, riskEvents } from '../db/schema.js'
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
const DM = 'dm-golden-hycosan'
const PI = 'pi-golden-hycosan'
const DRUG = 'drug-golden-hycosan'
const PLAN = 'plan-golden-hycosan'

let prevClients: AiClients | null = null

beforeAll(async () => {
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))

  await db.insert(drugMaster).values({
    id: DM,
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%（10mL:10mg）',
    form: '滴眼液',
  })
  await db.insert(packageInserts).values({
    id: PI,
    drugId: DM,
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%（10mL:10mg）',
    form: '滴眼液',
    indication: '用于缓解干眼症状，如眼睛干涩、异物感、疲劳等',
    components: '玻璃酸钠',
    contraindications: ['对玻璃酸钠过敏者禁用'],
    adverseReactions: '偶见眼部刺激感、异物感',
    precautions: ['开封后一个月内使用', '避免瓶口接触眼睛或皮肤'],
    interactions: '尚无明确相互作用资料',
    pharmacology: '玻璃酸钠为天然存在的多糖，具有保湿和润滑作用',
    storage: '密封，避光，不超过25℃保存',
    source: '丁香园用药助手（演示抄录）',
    version: '2024-01',
  })
  await db.insert(drugs).values({
    id: DRUG,
    userId: USER,
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
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
  await db.delete(plans).where(inArray(plans.id, [PLAN]))
  await db.delete(drugs).where(inArray(drugs.id, [DRUG]))
  await db.delete(packageInserts).where(eq(packageInserts.id, PI))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM))
})

beforeEach(async () => {
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
})

// ---------------------------------------------------------------------------
// 不变量 ①：响应结构（ConsultResponseSchema 全字段，shared 契约面）
// ---------------------------------------------------------------------------

describe('不变量 ① 响应结构', () => {
  it('answered 响应体字段面 = ConsultResponseSchema 全字段 + consultLogId；sections/citations 子结构齐备', async () => {
    prevClients = setAiClients(
      mockClients({
        consult: {
          summary: '玻璃酸钠滴眼液用于缓解干眼症状',
          keyPoints: ['保湿润滑作用'],
          risks: ['偶见眼部刺激感'],
          nextAction: '如症状持续请咨询眼科医生',
          warning: '不要自行调整处方',
        },
      }),
    )

    const res = await req('POST', '/api/consult', { question: '这个药通常用于什么？', drugIds: [DRUG] })

    expect(res.status).toBe(200)
    // 响应体字段面：{ ok } 包装 + shared ConsultResponseSchema 全字段 + api 扩展的 consultLogId，不多不少
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'ok',
        'riskLevel',
        'status',
        'answer',
        'sections',
        'citations',
        'notice',
        'l0Notice',
        'blocked',
        'toolUsed',
        'consultLogId',
      ].sort(),
    )
    // sections 五段结构 + api 内部 limited 标记透传（specs/04 附录 A4「五段 + limited 标记」；
    // shared ConsultSectionsSchema 仅声明五段——web 不消费 limited，收窄留给后续任务，不属本安全网行为变更）
    expect(Object.keys(res.body.sections).sort()).toEqual(
      ['summary', 'keyPoints', 'risks', 'nextAction', 'warning', 'limited'].sort(),
    )
    // citations 元素结构（三件套 + unverified）
    expect(Object.keys(res.body.citations[0]).sort()).toEqual(['drugName', 'source', 'version', 'unverified'].sort())
    // 标量字段类型面
    expect(typeof res.body.answer).toBe('string')
    expect(typeof res.body.blocked).toBe('boolean')
    expect(['L1', 'L2', 'L3', 'L4']).toContain(res.body.riskLevel)
  })
})

// ---------------------------------------------------------------------------
// 不变量 ②：守门行为（L4/L3/limited 各 ≥3 口语变体；静态保证拦截召回）
// ---------------------------------------------------------------------------

describe('不变量 ② 守门行为（口语变体）', () => {
  beforeEach(() => {
    // 守门命中时不应触达 LLM：mock 默认抛 AIUnavailableError 也不会被走到（L4/L3 固定文案先返回）
    prevClients = setAiClients(mockClients({}))
  })

  const L4_VARIANTS = ['我胸痛怎么办', '现在呼吸困难', '孩子大量误服了药片']
  const L3_VARIANTS = ['这个药能不能停', '我想换药', '能不能减量']

  for (const q of L4_VARIANTS) {
    it(`L4 拦截：「${q}」→ emergency + blocked + risk_events`, async () => {
      const res = await req('POST', '/api/consult', { question: q, drugIds: [DRUG] })
      expect(res.status).toBe(200)
      expect(res.body.riskLevel).toBe('L4')
      expect(res.body.status).toBe('emergency')
      expect(res.body.blocked).toBe(true)
      const events = await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))
      expect(events).toHaveLength(1)
      expect(events[0].level).toBe('L4')
    })
  }

  for (const q of L3_VARIANTS) {
    it(`L3 拒答：「${q}」→ refused + blocked + risk_events`, async () => {
      const res = await req('POST', '/api/consult', { question: q, drugIds: [DRUG] })
      expect(res.status).toBe(200)
      expect(res.body.riskLevel).toBe('L3')
      expect(res.body.status).toBe('refused')
      expect(res.body.blocked).toBe(true)
      const events = await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))
      expect(events).toHaveLength(1)
      expect(events[0].level).toBe('L3')
    })
  }
})

describe('不变量 ② L2 剂量过滤（LLM 输出变体）', () => {
  /** strip 切不干净 / 未被切除的剂量残留 → limited（每例均须触发，宁误杀不漏放）。 */
  const LIMITED_VARIANTS: Array<{ name: string; raw: Record<string, unknown> }> = [
    {
      name: 'summary 含「每日+N次」（strip 正则无「每日」关键词，切不干净）',
      raw: {
        summary: '每日使用超过10次需咨询医生',
        keyPoints: ['保湿作用'],
        risks: [],
        nextAction: '按医嘱使用',
        warning: '不要自行调整',
      },
    },
    {
      name: 'nextAction 含「每次+N片」（nextAction 不经 strip，残留即触发）',
      raw: {
        summary: '玻璃酸钠用于缓解干眼症状',
        keyPoints: ['保湿润滑'],
        risks: [],
        nextAction: '建议每次服用2片',
        warning: '不要自行调整',
      },
    },
    {
      name: 'keyPoints 含「每日上限N次」且不含 strip 关键词（残留触发）',
      raw: {
        summary: '用于干眼症',
        keyPoints: ['每日上限10次'],
        risks: [],
        nextAction: '如症状持续请就医',
        warning: '不要自行调整',
      },
    },
  ]

  for (const v of LIMITED_VARIANTS) {
    it(`limited：${v.name}`, async () => {
      prevClients = setAiClients(mockClients({ consult: v.raw as never }))
      const res = await req('POST', '/api/consult', { question: '这个药通常用于什么？', drugIds: [DRUG] })
      expect(res.status).toBe(200)
      expect(res.body.riskLevel).toBe('L2')
      expect(res.body.status).toBe('limited')
      expect(res.body.blocked).toBe(false)
      expect(res.body.notice).toContain('已过滤具体剂量建议')
    })
  }
})

// ---------------------------------------------------------------------------
// 不变量 ③：非拦截回答 citations 三件套非空（三条非拦截路径）
// ---------------------------------------------------------------------------

describe('不变量 ③ 非拦截回答 citations 三件套非空', () => {
  it('answered（LLM 路径）citations 三件套非空', async () => {
    prevClients = setAiClients(mockClients({ consult: { summary: '玻璃酸钠滴眼液用于缓解干眼症状' } }))
    const res = await req('POST', '/api/consult', { question: '这个药通常用于什么？', drugIds: [DRUG] })
    expect(res.body.status).toBe('answered')
    expect(res.body.citations.length).toBeGreaterThan(0)
    for (const c of res.body.citations) {
      expect(c.drugName.trim()).not.toBe('')
      expect(c.source.trim()).not.toBe('')
      expect(c.version.trim()).not.toBe('')
    }
  })

  it('data-answered（数据直答路径）citations 三件套非空', async () => {
    prevClients = setAiClients(mockClients({}))
    const res = await req('POST', '/api/consult', { question: '我现在有多少药物', drugIds: [] })
    expect(res.body.status).toBe('data-answered')
    expect(res.body.citations.length).toBeGreaterThan(0)
    for (const c of res.body.citations) {
      expect(c.drugName.trim()).not.toBe('')
      expect(c.source.trim()).not.toBe('')
      expect(c.version.trim()).not.toBe('')
    }
  })

  it('降级拼装路径（AI 不可用）citations 三件套非空', async () => {
    prevClients = setAiClients(
      mockClients({ consultAnswerError: new AIUnavailableError('baichuan', '模拟服务不可用') }),
    )
    const res = await req('POST', '/api/consult', { question: '这个药通常用于什么？', drugIds: [DRUG] })
    expect(res.body.status).toBe('answered')
    expect(res.body.citations.length).toBeGreaterThan(0)
    for (const c of res.body.citations) {
      expect(c.drugName.trim()).not.toBe('')
      expect(c.source.trim()).not.toBe('')
      expect(c.version.trim()).not.toBe('')
    }
  })
})

// ---------------------------------------------------------------------------
// 不变量 ④：降级语义（AI_UNAVAILABLE → 说明书规则拼装 + notice，仍 200）
// ---------------------------------------------------------------------------

describe('不变量 ④ 降级语义', () => {
  it('Baichuan 不可用 → 200 + answered + 回答来自说明书段落（非 LLM）+ notice 说明降级', async () => {
    prevClients = setAiClients(
      mockClients({ consultAnswerError: new AIUnavailableError('baichuan', '模拟服务不可用') }),
    )

    const res = await req('POST', '/api/consult', { question: '这个药通常用于什么？', drugIds: [DRUG] })

    expect(res.status).toBe(200) // 降级不炸整体
    expect(res.body.riskLevel).toBe('L1')
    expect(res.body.status).toBe('answered') // 语义化为 answered + notice，非 5xx
    expect(res.body.blocked).toBe(false)
    // 回答内容来自说明书适应症段规则拼装（fallbackSectionsFromInsert）
    expect(res.body.sections.summary).toContain('缓解干眼症状')
    // notice 明示降级（失败可见不静默）
    expect(res.body.notice).toContain('百川服务不可用')
    expect(res.body.notice).toContain('规则拼装')
  })
})
