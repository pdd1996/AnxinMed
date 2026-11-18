/**
 * 对象澄清与范围层 · 集成测试（M13-P1 · docs/14 §4 T4/T5；specs/17 T2/T3）。
 *
 * 红线断言：
 * - clarify / out-of-scope 均为 **0 次 LLM**（mock 默认抛错也能跑到固定文案）；
 * - 均不进 risk_events；consult_logs.status 如实落库；
 * - 空药箱不澄清（回退既有 no-source）；env kill switch 可整体回滚；
 * - 有绑定药时范围层仍生效（诊断/非用药话题），正常用药问题不受影响。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import {
  consultLogs,
  consultSessions,
  consultSuggestions,
  drugMaster,
  drugs,
  packageInserts,
  plans,
  records,
  riskEvents,
} from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients } from '../lib/ai/types.js'
import { toLegacyConsultStatus } from '../services/consult.service.js'
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
const DM = 'dm-p1-clarify'
const PI = 'pi-p1-clarify'
const DRUG_A = 'drug-p1-clarify-a'
const DRUG_B = 'drug-p1-clarify-b'
const ENV_KEYS = ['ENABLE_SCOPE_GATE', 'ENABLE_OBJECT_CLARIFY', 'ENABLE_ROUTE_NORMALIZE'] as const

const MOCK_ANSWER = {
  summary: '按说明书，这个药请在医生指导下使用。',
  keyPoints: ['说明书要点一'],
  risks: [],
  nextAction: '遵医嘱用药。',
  warning: '不要自行调整处方。',
}

let prevClients: AiClients | null = null
const prevEnv: Record<string, string | undefined> = {}

async function cleanupEvidence() {
  await db.delete(consultSuggestions).where(eq(consultSuggestions.userId, USER))
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(consultSessions).where(eq(consultSessions.userId, USER))
}

async function insertBoxDrugs() {
  await db.insert(drugs).values([
    {
      id: DRUG_A,
      userId: USER,
      genericName: '玻璃酸钠滴眼液',
      brandName: '海露',
      specification: '0.1%',
      form: '滴眼液',
      drugMasterId: DM,
      confirmStatus: 'ocr_matched',
    },
    {
      id: DRUG_B,
      userId: USER,
      genericName: '评测药B',
      brandName: null,
      specification: null,
      form: null,
      drugMasterId: null,
      confirmStatus: 'transcribed',
    },
  ])
}

beforeAll(async () => {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k]
  // 清空 p-001 既有数据 + 本文件资产，保证 fixture 确定性
  await cleanupEvidence()
  await db.delete(records).where(eq(records.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))

  await db.insert(drugMaster).values({
    id: DM,
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%',
    form: '滴眼液',
  })
  await db.insert(packageInserts).values({
    id: PI,
    curationStatus: 'reviewed',
    drugId: DM,
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%',
    form: '滴眼液',
    indication: '用于缓解干眼症状',
    components: '玻璃酸钠',
    dosage: { adult: { maxFrequencyPerDay: { value: 10, unit: '次' } } },
    contraindications: ['对玻璃酸钠过敏者禁用'],
    adverseReactions: '偶见眼部刺激感',
    precautions: ['开封后一个月内使用'],
    interactions: '尚无明确相互作用资料',
    pharmacology: '玻璃酸钠为天然存在的多糖，具有保湿作用',
    pharmacokinetics: '局部用药，几乎不吸收',
    storage: '密封，避光，不超过25℃保存',
    source: '评测来源',
    version: 'eval-2026-11',
  })
  await insertBoxDrugs()
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  for (const k of ENV_KEYS) {
    const v = prevEnv[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await cleanupEvidence()
  await db.delete(records).where(eq(records.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))
  await db.delete(packageInserts).where(eq(packageInserts.id, PI))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM))
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = prevEnv[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  prevClients = setAiClients(mockClients({}))
})

describe('对象澄清（status=clarify）', () => {
  it('无绑定药 +「这个药有什么副作用」→ clarify + 药名选项；0 次 LLM、不进 risk_events', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '这个药有什么副作用',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('clarify')
    expect(res.body.riskLevel).toBe('L1')
    expect(res.body.blocked).toBe(false)
    expect(res.body.citations).toEqual([])
    expect(res.body.answer).toContain('哪种药')
    const options = res.body.clarifyOptions as Array<{ drugId: string; drugName: string }>
    expect(options).toHaveLength(2)
    expect(options.map((o) => o.drugName)).toContain('玻璃酸钠滴眼液（海露）')
    expect(options.map((o) => o.drugName)).toContain('评测药B')
    expect(calls.consultAnswer).toBe(0)

    const events = await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))
    expect(events).toHaveLength(0)
    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs.at(-1)?.status).toBe('clarify')
  })

  it('点选药名后带 drugId 重问 → 走 S1 answered（clarify 只是入口，不写业务表）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls, consult: MOCK_ANSWER }))

    const res = await req('POST', '/api/consult', { question: '这个药有什么副作用', drugIds: [DRUG_A] })

    expect(res.body.status).toBe('answered')
    expect(res.body.citations.length).toBeGreaterThan(0)
    expect(res.body.clarifyOptions ?? null).toBeNull()
    expect(calls.consultAnswer).toBe(1)
  })

  it('无指代问题不澄清（「布洛芬能一起吃吗」→ 既有 no-source）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', { question: '布洛芬能一起吃吗', drugIds: [] })

    expect(res.body.status).toBe('no-source')
    expect(res.body.clarifyOptions ?? null).toBeNull()
    expect(calls.consultAnswer).toBe(0)
  })

  it('T7 归一化：「这药有什么副作用」（指代变体）→ clarify；0 次 LLM', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '这药有什么副作用',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('clarify')
    expect(res.body.clarifyOptions?.length).toBeGreaterThan(0)
    expect(calls.consultAnswer).toBe(0)
  })

  it('T7 归一化关闭：「这药有什么副作用」不再命中指代信号 → 回退 no-source', async () => {
    process.env.ENABLE_ROUTE_NORMALIZE = 'false'
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '这药有什么副作用',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.body.status).toBe('no-source')
    expect(calls.consultAnswer).toBe(0)
  })

  it('空药箱 → 不澄清，回退既有 no-source（引导去录入）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))
    await db.delete(drugs).where(eq(drugs.userId, USER))
    try {
      const res = await req('POST', '/api/consult', { question: '这个药有什么副作用', drugIds: [] })
      expect(res.body.status).toBe('no-source')
      expect(res.body.clarifyOptions ?? null).toBeNull()
      expect(calls.consultAnswer).toBe(0)
    } finally {
      await insertBoxDrugs()
    }
  })

  it('ENABLE_OBJECT_CLARIFY=false → 回退 no-source（kill switch）', async () => {
    process.env.ENABLE_OBJECT_CLARIFY = 'false'
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', { question: '这个药有什么副作用', drugIds: [] })

    expect(res.body.status).toBe('no-source')
    expect(calls.consultAnswer).toBe(0)
  })
})

describe('范围层（status=out-of-scope）', () => {
  it('诊断请求（无药上下文）→ out-of-scope 固定文案；0 次 LLM、不进 risk_events', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '我是不是得了糖尿病',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('out-of-scope')
    expect(res.body.riskLevel).toBe('L1')
    expect(res.body.blocked).toBe(false)
    expect(res.body.answer).toContain('不能做诊断')
    expect(calls.consultAnswer).toBe(0)

    const events = await db.select().from(riskEvents).where(eq(riskEvents.userId, USER))
    expect(events).toHaveLength(0)
    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs.at(-1)?.status).toBe('out-of-scope')
  })

  it('非用药话题即使有绑定药也拒绝（「帮我写个劳动合同」）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '帮我写个劳动合同',
      drugIds: [DRUG_A],
      consultStatusVersion: 2,
    })

    expect(res.body.status).toBe('out-of-scope')
    expect(res.body.answer).toContain('服务范围')
    expect(calls.consultAnswer).toBe(0)
  })

  it('诊断请求即使有绑定药也拒绝（「帮我看看这个检查报告是不是癌症」）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '帮我看看这个检查报告是不是癌症',
      drugIds: [DRUG_A],
      consultStatusVersion: 2,
    })

    expect(res.body.status).toBe('out-of-scope')
    expect(calls.consultAnswer).toBe(0)
  })

  it('保守放行：「这个药能治什么病」不是诊断请求 → 正常 answered', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls, consult: MOCK_ANSWER }))

    const res = await req('POST', '/api/consult', {
      question: '这个药能治什么病',
      drugIds: [DRUG_A],
    })

    expect(res.body.status).toBe('answered')
    expect(calls.consultAnswer).toBe(1)
  })

  it('ENABLE_SCOPE_GATE=false → 诊断请求不再拒绝（回退既有 S1 管线）', async () => {
    process.env.ENABLE_SCOPE_GATE = 'false'
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', { question: '我是不是得了糖尿病', drugIds: [] })

    expect(res.body.status).not.toBe('out-of-scope')
    expect(res.body.status).toBe('no-source')
    expect(calls.consultAnswer).toBe(0)
  })
})

describe('旧客户端状态降级（M13-P1 · A1 客户端容错）', () => {
  it('toLegacyConsultStatus 只降级 clarify / out-of-scope，旧枚举原样', () => {
    expect(toLegacyConsultStatus('clarify')).toBe('no-source')
    expect(toLegacyConsultStatus('out-of-scope')).toBe('no-source')
    expect(toLegacyConsultStatus('answered')).toBe('answered')
    expect(toLegacyConsultStatus('no-source')).toBe('no-source')
    expect(toLegacyConsultStatus('emergency')).toBe('emergency')
  })

  it('不带 consultStatusVersion：clarify 响应降级为 no-source（仍带 clarifyOptions；落库真实状态 clarify）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', { question: '这个药有什么副作用', drugIds: [] })

    expect(res.body.status).toBe('no-source')
    expect((res.body.clarifyOptions as unknown[]).length).toBeGreaterThan(0)
    expect(res.body.answer).toContain('哪种药')
    expect(calls.consultAnswer).toBe(0)

    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs.at(-1)?.status).toBe('clarify')
  })

  it('不带 consultStatusVersion：out-of-scope 响应降级为 no-source（落库真实状态 out-of-scope）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', { question: '我是不是得了糖尿病', drugIds: [] })

    expect(res.body.status).toBe('no-source')
    expect(res.body.answer).toContain('不能做诊断')
    expect(calls.consultAnswer).toBe(0)

    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs.at(-1)?.status).toBe('out-of-scope')
  })
})
