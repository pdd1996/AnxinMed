/**
 * 过敏确定性覆盖层测试（M4-T4 · specs/04-T4）——纯函数单测 + app.request() 集成。
 *
 * 完成标准对照：
 * - 纯函数单测：命中 / 不命中 / 多过敏词 / 无档案 / 禁忌段缺失；
 * - 集成：档案过敏词 + 对象药禁忌段含该词 → **既有回答内容不变、仅追加警示与引用**；
 * - 覆盖层零 LLM：命中与不命中两次请求 consultAnswer 调用数一致（mock 计数）；
 * - 不改 riskLevel、不进 risk_events；S0/S2 路径不附加。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { consultLogs, drugMaster, drugs, healthProfiles, packageInserts, riskEvents } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients } from '../lib/ai/types.js'
import { mockClients, newCalls } from './helpers/ai-mocks.js'
import {
  ALLERGY_FIELD_KEY,
  allergyOverlay,
  extractAllergyKeywords,
  normalizeAllergyToken,
} from '../services/consult/allergy.js'
import type { Citation, NormalizedSections } from '../services/consult/types.js'

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
// 纯函数单测
// ---------------------------------------------------------------------------

describe('normalizeAllergyToken · 过敏词归一化', () => {
  it('去「对」前缀与「过敏」「史」后缀取核心词', () => {
    expect(normalizeAllergyToken('对青霉素过敏')).toBe('青霉素')
    expect(normalizeAllergyToken('青霉素过敏')).toBe('青霉素')
    expect(normalizeAllergyToken('青霉素史')).toBe('青霉素')
    expect(normalizeAllergyToken('磺胺')).toBe('磺胺')
    expect(normalizeAllergyToken(' 对阿司匹林 过敏 ')).toBe('阿司匹林')
  })
})

describe('extractAllergyKeywords · 白名单只读提取', () => {
  it('只取「过敏史」字段；多词按分隔符拆分 + 归一化 + 去重；单字过滤', () => {
    const rows = [
      { fieldKey: ALLERGY_FIELD_KEY, value: '对青霉素过敏、磺胺' },
      { fieldKey: '诊断', value: '高血压' }, // 非过敏字段绝不进咨询链路
      { fieldKey: ALLERGY_FIELD_KEY, value: '青霉素' }, // 跨行去重
      { fieldKey: ALLERGY_FIELD_KEY, value: '硫' }, // 单字核心词过滤
    ]
    expect(extractAllergyKeywords(rows)).toEqual(['青霉素', '磺胺'])
  })

  it('无档案 / 空值 → 空数组', () => {
    expect(extractAllergyKeywords([])).toEqual([])
    expect(extractAllergyKeywords([{ fieldKey: ALLERGY_FIELD_KEY, value: null }])).toEqual([])
  })
})

describe('allergyOverlay · 纯函数', () => {
  const baseSections: NormalizedSections = {
    summary: '玻璃酸钠滴眼液用于缓解干眼症状',
    keyPoints: ['保湿润滑'],
    risks: ['偶见眼部刺激感'],
    nextAction: '如症状持续请咨询医生',
    warning: '不要自行调整处方',
    limited: false,
  }
  const baseCitations: Citation[] = [
    { drugName: '青霉素V钾片', source: '丁香园（演示）', version: '2024-01', unverified: false },
  ]

  it('命中：risks 追加固定警示（含核心词）+ citations 追加禁忌段引用（sectionLabel=禁忌）；原对象不变', () => {
    const sections = { ...baseSections, risks: [...baseSections.risks] }
    const citations = [...baseCitations]
    const out = allergyOverlay(['青霉素'], ['对青霉素过敏者禁用'], sections, citations)

    expect(out.sections.risks).toHaveLength(2)
    expect(out.sections.risks[1]).toContain('过敏警示')
    expect(out.sections.risks[1]).toContain('青霉素')
    expect(out.citations).toHaveLength(2)
    expect(out.citations[1]).toMatchObject({
      drugName: '青霉素V钾片',
      source: '丁香园（演示）',
      version: '2024-01',
      unverified: false,
      sectionLabel: '禁忌',
    })
    // 既有回答内容不变（原数组未被原地修改）
    expect(sections.risks).toHaveLength(1)
    expect(citations).toHaveLength(1)
    // 追加不改动既有分区
    expect(out.sections.summary).toBe(baseSections.summary)
    expect(out.sections.keyPoints).toEqual(baseSections.keyPoints)
  })

  it('不命中：原样返回（同一引用，零修改）', () => {
    const out = allergyOverlay(['青霉素'], ['对磺胺类药物过敏者禁用'], baseSections, baseCitations)
    expect(out.sections).toBe(baseSections)
    expect(out.citations).toBe(baseCitations)
  })

  it('多过敏词全部命中 → 单条警示列出全部核心词', () => {
    const out = allergyOverlay(['青霉素', '磺胺'], ['对青霉素过敏者禁用', '对磺胺类药物过敏者禁用'], baseSections, baseCitations)
    expect(out.sections.risks).toHaveLength(2)
    expect(out.sections.risks[1]).toContain('青霉素')
    expect(out.sections.risks[1]).toContain('磺胺')
  })

  it('无关键词（无档案）→ 原样返回', () => {
    const out = allergyOverlay([], ['对青霉素过敏者禁用'], baseSections, baseCitations)
    expect(out.sections).toBe(baseSections)
    expect(out.citations).toBe(baseCitations)
  })

  it('禁忌段缺失（null / 空数组 / 空串）→ 原样返回', () => {
    for (const contra of [null, [], '', ['  ']]) {
      const out = allergyOverlay(['青霉素'], contra, baseSections, baseCitations)
      expect(out.sections).toBe(baseSections)
      expect(out.citations).toBe(baseCitations)
    }
  })

  it('citations 为空（引用溯源无从附加）→ 防御性原样返回', () => {
    const out = allergyOverlay(['青霉素'], ['对青霉素过敏者禁用'], baseSections, [])
    expect(out.sections).toBe(baseSections)
    expect(out.citations).toEqual([])
  })

  it('拉丁药名大小写不敏感命中', () => {
    const out = allergyOverlay(['Aspirin'], ['对ASPIRIN过敏者禁用'], baseSections, baseCitations)
    expect(out.sections.risks).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 集成测试（app.request()，跑独立测试库）
// ---------------------------------------------------------------------------

const USER = 'p-001'
const DM = 'dm-allergy-penicillin'
const PI = 'pi-allergy-penicillin'
const DRUG = 'drug-allergy-penicillin'

let prevClients: AiClients | null = null

/** 清理本文件的 p-001 痕迹（过敏史字段行 + 咨询留痕 + 药品资产）。 */
async function cleanup() {
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db
    .delete(healthProfiles)
    .where(and(eq(healthProfiles.userId, USER), eq(healthProfiles.fieldKey, ALLERGY_FIELD_KEY)))
  await db.delete(drugs).where(eq(drugs.id, DRUG))
  await db.delete(packageInserts).where(eq(packageInserts.id, PI))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM))
}

beforeAll(async () => {
  await cleanup()
  await db.insert(drugMaster).values({
    id: DM,
    genericName: '青霉素V钾片',
    specification: '0.236g（40万单位）',
    form: '片剂',
  })
  await db.insert(packageInserts).values({
    id: PI,
    drugId: DM,
    genericName: '青霉素V钾片',
    specification: '0.236g（40万单位）',
    form: '片剂',
    indication: '用于青霉素敏感菌株所致的轻中度感染',
    contraindications: ['对青霉素过敏者禁用', '对磺胺类药物过敏者禁用'],
    adverseReactions: '偶见皮疹、恶心',
    source: '丁香园用药助手（演示抄录）',
    version: '2024-01',
  })
  await db.insert(drugs).values({
    id: DRUG,
    userId: USER,
    genericName: '青霉素V钾片',
    specification: '0.236g',
    form: '片剂',
    drugMasterId: DM,
    confirmStatus: 'ocr_matched',
  })
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await cleanup()
})

beforeEach(async () => {
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  // 过敏史档案行随用例内建、用例前清——用例间零泄漏
  await db
    .delete(healthProfiles)
    .where(and(eq(healthProfiles.userId, USER), eq(healthProfiles.fieldKey, ALLERGY_FIELD_KEY)))
})

const MOCK_CONSULT = {
  summary: '青霉素V钾片用于敏感菌所致的轻中度感染',
  keyPoints: ['处方药需遵医嘱使用'],
  risks: ['偶见皮疹、恶心'],
  nextAction: '如症状未缓解请复诊',
  warning: '不要自行调整处方',
}

describe('过敏覆盖层集成 · POST /api/consult', () => {
  it('档案过敏词 ∩ 禁忌段命中 → 既有回答不变、仅追加警示与禁忌段引用；LLM 调用数不变', async () => {
    await db.insert(healthProfiles).values({
      id: 'hp-allergy-1',
      userId: USER,
      fieldKey: ALLERGY_FIELD_KEY,
      value: '对青霉素过敏、磺胺',
    })
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls, consult: MOCK_CONSULT }))

    const res = await req('POST', '/api/consult', { question: '这个药通常用于什么？', drugIds: [DRUG] })

    expect(res.status).toBe(200)
    expect(res.body.riskLevel).toBe('L1') // 提示非拦截：不改 riskLevel
    expect(res.body.status).toBe('answered')

    // 既有回答内容不变：summary / keyPoints / 原 risks 保持
    expect(res.body.sections.summary).toBe(MOCK_CONSULT.summary)
    expect(res.body.sections.keyPoints).toEqual(MOCK_CONSULT.keyPoints)
    expect(res.body.sections.risks[0]).toBe('偶见皮疹、恶心')
    // 仅追加：固定警示（核心词列出）+ 禁忌段引用
    expect(res.body.sections.risks[1]).toContain('过敏警示')
    expect(res.body.sections.risks[1]).toContain('青霉素')
    expect(res.body.sections.risks[1]).toContain('磺胺')
    expect(res.body.citations).toHaveLength(2)
    expect(res.body.citations[1].sectionLabel).toBe('禁忌')
    // 覆盖层零新增 LLM：consultAnswer 恰 1 次（回答本身）
    expect(calls.consultAnswer).toBe(1)

    // consult_logs 快照含警示（留痕完整）
    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(JSON.stringify(logs[0].sectionsSnapshot)).toContain('过敏警示')
  })

  it('对照组：无过敏档案 → 同问题同 mock 输出，无警示、单引用、consultAnswer 仍 1 次（内容逐字一致）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls, consult: MOCK_CONSULT }))

    const res = await req('POST', '/api/consult', { question: '这个药通常用于什么？', drugIds: [DRUG] })

    expect(res.status).toBe(200)
    expect(res.body.sections.risks).toEqual(['偶见皮疹、恶心'])
    expect(res.body.sections.summary).toBe(MOCK_CONSULT.summary)
    expect(res.body.citations).toHaveLength(1)
    expect(calls.consultAnswer).toBe(1)
  })

  it('S0 不附加：档案命中过敏但提问触发 L4 → 固定急救文案原样，无过敏警示', async () => {
    await db.insert(healthProfiles).values({
      id: 'hp-allergy-2',
      userId: USER,
      fieldKey: ALLERGY_FIELD_KEY,
      value: '青霉素',
    })
    prevClients = setAiClients(mockClients({}))

    const res = await req('POST', '/api/consult', { question: '我胸痛，这个药我过敏', drugIds: [DRUG] })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('emergency')
    expect(res.body.riskLevel).toBe('L4')
    expect(JSON.stringify(res.body.sections.risks)).not.toContain('过敏警示')
    // L4 不附加禁忌段引用（守门文案 citations 为空数组）
    expect(res.body.citations).toEqual([])
  })

  it('S2 不附加：数据直答路径无对象药禁忌段上下文', async () => {
    await db.insert(healthProfiles).values({
      id: 'hp-allergy-3',
      userId: USER,
      fieldKey: ALLERGY_FIELD_KEY,
      value: '青霉素',
    })
    prevClients = setAiClients(mockClients({}))

    const res = await req('POST', '/api/consult', { question: '我现在有多少药物', drugIds: [] })

    expect(res.body.status).toBe('data-answered')
    expect(JSON.stringify(res.body.sections.risks)).not.toContain('过敏警示')
  })
})
