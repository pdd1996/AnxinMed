/**
 * conditions 交集注入测试（M4-T8 · specs/04-T8，裁决 #3）。
 *
 * 完成标准对照：
 * - ai-clients 请求体白名单断言（buildConsultRequest 纯函数部分在 ai-clients.test.ts）；
 * - PII 零泄漏断言扩展：档案「诊断」值含手机号 → 进 LLM payload 前被脱敏（捕获式 mock 断言）；
 * - 「注入前后守门/过滤行为一致」专项 golden（注入 conditions 后，L4/L3/limited 行为与
 *   不注入时逐例一致——prompt 变化不得影响守门与输出过滤）；
 * - 回答内容仍基于说明书 mock（注入只加背景块，不改变回答结构契约）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { consultLogs, drugMaster, drugs, healthProfiles, packageInserts, riskEvents } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients, ConsultPromptPayload } from '../lib/ai/types.js'
import { mockClients } from './helpers/ai-mocks.js'
import { extractConditions, CONDITIONS_FIELD_KEY } from '../services/consult/conditions.js'
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

// ---------------------------------------------------------------------------
// extractConditions 纯函数
// ---------------------------------------------------------------------------

describe('extractConditions · 档案慢病提取（纯函数）', () => {
  it('只取「诊断」字段；多词拆分 + 去重', () => {
    const rows = [
      { fieldKey: CONDITIONS_FIELD_KEY, value: '高血压、2型糖尿病' },
      { fieldKey: '过敏史', value: '青霉素' }, // 非诊断字段不进 prompt 通道（走 T4 覆盖层）
      { fieldKey: '特殊状态', value: '孕妇' },
      { fieldKey: CONDITIONS_FIELD_KEY, value: '高血压' },
    ]
    expect(extractConditions(rows)).toEqual(['高血压', '2型糖尿病'])
  })

  it('封顶：条数 ≤10、总字数 ≤200（超限截断，宁少注入）', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ fieldKey: CONDITIONS_FIELD_KEY, value: `慢病${i}` }))
    expect(extractConditions(many)).toHaveLength(10)
    const long = [{ fieldKey: CONDITIONS_FIELD_KEY, value: '甲'.repeat(150) }, { fieldKey: CONDITIONS_FIELD_KEY, value: '乙'.repeat(150) }]
    const out = extractConditions(long)
    expect(out).toHaveLength(1)
    expect(out[0]).toHaveLength(150)
  })

  it('无档案 / 空值 → 空数组（= 不注入）', () => {
    expect(extractConditions([])).toEqual([])
    expect(extractConditions([{ fieldKey: CONDITIONS_FIELD_KEY, value: null }])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 集成：payload 捕获（脱敏 + 注入形态）+ 注入前后守门/过滤行为一致专项 golden
// ---------------------------------------------------------------------------

const USER = 'p-001'
const DM = 'dm-cond-hycosan'
const PI = 'pi-cond-hycosan'
const DRUG = 'drug-cond-hycosan'

const MOCK_CONSULT = {
  summary: '玻璃酸钠滴眼液用于缓解干眼症状',
  keyPoints: ['保湿润滑作用'],
  risks: ['偶见眼部刺激感'],
  nextAction: '如症状持续请咨询眼科医生',
  warning: '不要自行调整处方',
}

let capturedPayload: ConsultPromptPayload | null = null
let prevClients: AiClients | null = null

/** 捕获式 mock：透传 mockClients 行为并记录 consultAnswer 收到的 payload（白名单/零泄漏断言用）。 */
function captureClients(): AiClients {
  const base = mockClients({ consult: MOCK_CONSULT })
  return {
    ...base,
    async consultAnswer(p: ConsultPromptPayload) {
      capturedPayload = p
      return MOCK_CONSULT
    },
  }
}

async function cleanup() {
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db
    .delete(healthProfiles)
    .where(and(eq(healthProfiles.userId, USER), eq(healthProfiles.fieldKey, CONDITIONS_FIELD_KEY)))
  await db.delete(drugs).where(eq(drugs.id, DRUG))
  await db.delete(packageInserts).where(eq(packageInserts.id, PI))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM))
}

beforeAll(async () => {
  await cleanup()
  await db.insert(drugMaster).values({
    id: DM,
    genericName: '玻璃酸钠滴眼液',
    specification: '0.1%（10mL:10mg）',
    form: '滴眼液',
  })
  await db.insert(packageInserts).values({
    id: PI,
    drugId: DM,
    genericName: '玻璃酸钠滴眼液',
    specification: '0.1%（10mL:10mg）',
    form: '滴眼液',
    indication: '用于缓解干眼症状',
    contraindications: ['对玻璃酸钠过敏者禁用'],
    adverseReactions: '偶见眼部刺激感',
    source: '丁香园用药助手（演示抄录）',
    version: '2024-01',
  })
  await db.insert(drugs).values({
    id: DRUG,
    userId: USER,
    genericName: '玻璃酸钠滴眼液',
    specification: '0.1%',
    form: '滴眼液',
    drugMasterId: DM,
    confirmStatus: 'ocr_matched',
  })
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await cleanup()
})

beforeEach(async () => {
  capturedPayload = null
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db
    .delete(healthProfiles)
    .where(and(eq(healthProfiles.userId, USER), eq(healthProfiles.fieldKey, CONDITIONS_FIELD_KEY)))
})

describe('conditions 注入集成 · payload 形态与零泄漏', () => {
  it('档案「诊断」→ payload.conditions 逐值注入；值中 PII 已脱敏（零泄漏断言扩展）', async () => {
    await db.insert(healthProfiles).values({
      id: 'hp-cond-1',
      userId: USER,
      fieldKey: CONDITIONS_FIELD_KEY,
      value: '高血压、青光眼，联系电话13812345678',
    })
    prevClients = setAiClients(captureClients())

    const res = await req('POST', '/api/consult', { question: '这个药通常用于什么？', drugIds: [DRUG] })
    expect(res.status).toBe(200)

    const p = capturedPayload as unknown as ConsultPromptPayload | null
    expect(p).not.toBeNull()
    // 逐字段断言：注入块 = 慢病清单（值被分隔拆分，PII 已被 scrub 成 [已脱敏] 片段）
    expect(p!.conditions).toBeDefined()
    expect(p!.conditions).toContain('高血压')
    expect(p!.conditions).toContain('青光眼')
    const joined = JSON.stringify(p)
    expect(joined).not.toContain('13812345678')
    expect(findPii((p!.conditions ?? []).join('、'))).toEqual([])
    // 药品白名单字段不受影响
    expect(p!.drug.genericName).toBe('玻璃酸钠滴眼液')
  })

  it('无档案 → payload.conditions 为空/缺省（prompt 通道不注入）', async () => {
    prevClients = setAiClients(captureClients())
    const res = await req('POST', '/api/consult', { question: '这个药通常用于什么？', drugIds: [DRUG] })
    expect(res.status).toBe(200)
    const p = capturedPayload as unknown as ConsultPromptPayload | null
    expect(p!.conditions ?? []).toEqual([])
  })

  it('S2 数据直答路径不注入（无 LLM 调用，payload 不存在）', async () => {
    await db.insert(healthProfiles).values({
      id: 'hp-cond-2',
      userId: USER,
      fieldKey: CONDITIONS_FIELD_KEY,
      value: '高血压',
    })
    prevClients = setAiClients(captureClients())
    const res = await req('POST', '/api/consult', { question: '我现在有多少药物', drugIds: [] })
    expect(res.body.status).toBe('data-answered')
    expect(capturedPayload).toBeNull()
  })
})

describe('专项 golden · 注入前后守门/过滤行为一致（M4-T8）', () => {
  /** 三类行为变体：L4 紧急 / L3 拒答 / L2 剂量过滤（LLM 输出含剂量残留）。 */
  const VARIANTS: Array<{ name: string; question: string; consult?: typeof MOCK_CONSULT }> = [
    { name: 'L4 紧急', question: '我胸痛' },
    { name: 'L3 拒答', question: '能不能停药' },
    {
      name: 'L2 剂量过滤',
      question: '这个药通常用于什么？',
      consult: {
        summary: '每日使用超过10次需咨询医生',
        keyPoints: ['保湿'],
        risks: [],
        nextAction: '按医嘱使用',
        warning: 'w',
      },
    },
  ]

  for (const v of VARIANTS) {
    it(`注入 conditions 后「${v.name}」行为与不注入逐例一致`, async () => {
      // 第一轮：无档案
      prevClients = setAiClients(mockClients({ consult: v.consult as never }))
      const before = await req('POST', '/api/consult', { question: v.question, drugIds: [DRUG] })
      const beforeLogs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))

      // 第二轮：注入档案慢病
      await db.insert(healthProfiles).values({
        id: 'hp-cond-golden',
        userId: USER,
        fieldKey: CONDITIONS_FIELD_KEY,
        value: '高血压、青光眼',
      })
      // 留痕基线：第二轮前的事件数（riskEvents 跨轮累积，断言用增量）
      const beforeEvents = (await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))).length

      const after = await req('POST', '/api/consult', { question: v.question, drugIds: [DRUG] })

      // 守门/过滤行为逐字段一致（status / riskLevel / blocked / notice / sections 摘要）
      expect(after.status).toBe(before.status)
      expect(after.body.riskLevel).toBe(before.body.riskLevel)
      expect(after.body.status).toBe(before.body.status)
      expect(after.body.blocked).toBe(before.body.blocked)
      expect(after.body.notice).toBe(before.body.notice)
      expect(after.body.sections?.summary ?? null).toBe(before.body.sections?.summary ?? null)
      expect(after.body.sections?.limited ?? null).toBe(before.body.sections?.limited ?? null)
      // 留痕一致：第二轮相对第一轮的 risk_events 增量 = 第一轮的拦截数（L4/L3 各新增一条，L2 为 0）
      const afterEvents = (await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))).length
      expect(afterEvents - beforeEvents).toBe(beforeLogs.filter((l) => l.blockedAt !== null).length)
    })
  }
})
