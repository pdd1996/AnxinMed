/**
 * 确认式建议卡测试（M4-T6 · specs/04-T6）——规则纯函数单测 + app.request() 集成。
 *
 * 完成标准对照：
 * - 纯函数单测含不误报案例（问已入库药不弹卡、泛指词不弹卡）；
 * - 「无用户确认零写入」集成红线断言（accept 端点不产生 drugs/plans/health_profiles 任何写入）；
 * - 留痕落 consult_suggestions；频控（每轮 ≤1 / 每会话 ≤3 / dismissed 不复弹）；
 * - S0 红线不打扰；note_symptom 纯引导不落库（裁决 #4）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import {
  consultLogs,
  consultSessions,
  consultSuggestions,
  drugMaster,
  drugs,
  healthProfiles,
  plans,
  riskEvents,
} from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients } from '../lib/ai/types.js'
import { mockClients } from './helpers/ai-mocks.js'
import { matchAddDrug, matchSymptomGuide, type SuggestionMasterRef } from '../services/consult/suggestion.js'

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
// 纯函数单测（规则层，零 I/O）
// ---------------------------------------------------------------------------

const MASTERS: SuggestionMasterRef[] = [
  { genericName: '布洛芬片', brandName: '芬必得' },
  { genericName: '对乙酰氨基酚片', brandName: '泰诺林' },
  { genericName: '钙片', brandName: null },
]

describe('matchAddDrug · add_drug 规则（纯函数）', () => {
  it('通用名全名命中', () => {
    expect(matchAddDrug('对乙酰氨基酚片能和我这个药一起吃吗', MASTERS, [], [])).toEqual({
      drugName: '对乙酰氨基酚片',
      matchedOn: 'generic',
    })
  })

  it('剂型剥离核心词命中（布洛芬 ⊂ 布洛芬片）', () => {
    expect(matchAddDrug('布洛芬能一起吃吗', MASTERS, [], [])).toEqual({ drugName: '布洛芬片', matchedOn: 'generic' })
  })

  it('商品名命中（规范化：大小写/空白不敏感）', () => {
    expect(matchAddDrug('泰诺林 和我的药冲突吗', MASTERS, [], [])).toEqual({
      drugName: '对乙酰氨基酚片',
      matchedOn: 'brand',
    })
  })

  it('不误报 · 问已入库药不弹卡（通用名在箱）', () => {
    expect(matchAddDrug('布洛芬能一起吃吗', MASTERS, ['布洛芬片'], [])).toBeNull()
  })

  it('不误报 · 问商品名而箱里存通用名（双向子串）也不弹卡', () => {
    expect(matchAddDrug('芬必得能一起吃吗', MASTERS, ['布洛芬片'], [])).toBeNull()
  })

  it('不误报 · 泛指词不弹卡（剂型剥离后核心词 <3 字）', () => {
    expect(matchAddDrug('钙片能一起吃吗', MASTERS, [], [])).toBeNull()
  })

  it('不误报 · 自由文本无药名不弹卡', () => {
    expect(matchAddDrug('我今天有点头晕', MASTERS, [], [])).toBeNull()
    expect(matchAddDrug('', MASTERS, [], [])).toBeNull()
  })

  it('dismissed 不复弹（按建议规范名 = master 通用名排除；商品名命中同一 master 同样被挡）', () => {
    expect(matchAddDrug('布洛芬能一起吃吗', MASTERS, [], ['布洛芬片'])).toBeNull()
    expect(matchAddDrug('芬必得能一起吃吗', MASTERS, [], ['布洛芬片'])).toBeNull()
  })

  it('每轮 ≤1：命中第一个 master 即返回', () => {
    const m = matchAddDrug('布洛芬和对乙酰氨基酚一起吃冲突吗', MASTERS, [], [])
    expect(m?.drugName).toBe('布洛芬片')
  })
})

describe('matchSymptomGuide · 症状引导规则（纯函数）', () => {
  it('含不适/症状词命中', () => {
    expect(matchSymptomGuide('我今天有点头晕')).toBe(true)
    expect(matchSymptomGuide('吃药后胃不舒服')).toBe(true)
  })
  it('普通问题不命中', () => {
    expect(matchSymptomGuide('这个药通常用于什么')).toBe(false)
    expect(matchSymptomGuide('我现在有多少药物')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 集成测试（app.request()，跑独立测试库）
// ---------------------------------------------------------------------------

const USER = 'p-001'
const OTHER_USER = 'p-002'
const DM = 'dm-suggest-ibu'
const DRUG_OWNED = 'drug-suggest-owned'

let prevClients: AiClients | null = null

async function cleanup() {
  for (const uid of [USER, OTHER_USER]) {
    await db.delete(consultSuggestions).where(eq(consultSuggestions.userId, uid))
    await db.delete(consultLogs).where(eq(consultLogs.userId, uid))
    await db.delete(consultSessions).where(eq(consultSessions.userId, uid))
    await db.delete(riskEvents).where(eq(riskEvents.userId, uid))
  }
  await db.delete(drugs).where(eq(drugs.id, DRUG_OWNED))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM))
}

beforeAll(async () => {
  await cleanup()
  // 库里放一个可被提问命中的 master（布洛芬片），药箱初始为空
  await db.insert(drugMaster).values({
    id: DM,
    genericName: '布洛芬片',
    brandName: '芬必得',
    specification: '0.3g',
    form: '片剂',
  })
  prevClients = setAiClients(mockClients({})) // no-source / data 路径不触达 LLM，mock 仅兜底
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await cleanup()
})

beforeEach(async () => {
  await db.delete(consultSuggestions).where(eq(consultSuggestions.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(consultSessions).where(eq(consultSessions.userId, USER))
  await db.delete(drugs).where(eq(drugs.id, DRUG_OWNED))
})

/** 当前用户药箱/计划/档案三表行数（零写入红线断言用）。 */
async function userDomainCounts() {
  const [d] = await db.select({ c: drugMaster.id }).from(drugMaster).where(eq(drugMaster.id, DM))
  const boxRows = await db.select({ id: drugs.id }).from(drugs).where(eq(drugs.userId, USER))
  const planRows = await db.select({ id: plans.id }).from(plans).where(eq(plans.userId, USER))
  const profileRows = await db
    .select({ id: healthProfiles.id })
    .from(healthProfiles)
    .where(eq(healthProfiles.userId, USER))
  return { masterExists: Boolean(d), box: boxRows.length, plans: planRows.length, profiles: profileRows.length }
}

describe('建议卡集成 · add_drug 命中与留痕', () => {
  it('提问命中未入库 master → response.suggestion add_drug + consult_suggestions 落 pending 行', async () => {
    const res = await req('POST', '/api/consult', { question: '布洛芬能一起吃吗', drugIds: [] })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('no-source') // 无对象药 → no-source 回答，卡片仍生成
    expect(res.body.suggestion).toMatchObject({ type: 'add_drug', drugName: '布洛芬片' })
    expect(String(res.body.suggestion.id)).not.toBe('')

    const rows = await db.select().from(consultSuggestions).where(eq(consultSuggestions.userId, USER))
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('add_drug')
    expect(rows[0].status).toBe('pending')
    expect(rows[0].payload).toMatchObject({ drugName: '布洛芬片' })
    expect(rows[0].sessionId).toBe(res.body.sessionId)
    expect(rows[0].consultLogId).toBe(res.body.consultLogId)
  })

  it('不误报 · 问已入库药（箱里有布洛芬）→ 无卡片、无落库', async () => {
    await db.insert(drugs).values({
      id: DRUG_OWNED,
      userId: USER,
      genericName: '布洛芬片',
      specification: '0.3g',
      form: '片剂',
      drugMasterId: DM,
      confirmStatus: 'ocr_matched',
    })
    const res = await req('POST', '/api/consult', { question: '布洛芬能一起吃吗', drugIds: [] })
    expect(res.status).toBe(200)
    expect(res.body.suggestion).toBeNull()
    const rows = await db.select().from(consultSuggestions).where(eq(consultSuggestions.userId, USER))
    expect(rows).toHaveLength(0)
  })
})

describe('建议卡集成 · note_symptom 纯引导（不落库，裁决 #4）', () => {
  it('提问含不适词 → note_symptom 卡（无 id），consult_suggestions 零落库', async () => {
    const res = await req('POST', '/api/consult', { question: '我今天有点头晕', drugIds: [] })
    expect(res.status).toBe(200)
    expect(res.body.suggestion).toEqual({ type: 'note_symptom' })
    const rows = await db.select().from(consultSuggestions).where(eq(consultSuggestions.userId, USER))
    expect(rows).toHaveLength(0)
  })
})

describe('建议卡集成 · S0 红线不打扰', () => {
  it('L4 命中 → 无卡片', async () => {
    const res = await req('POST', '/api/consult', { question: '我胸痛得厉害', drugIds: [] })
    expect(res.body.status).toBe('emergency')
    expect(res.body.suggestion).toBeNull()
  })
})

describe('建议卡集成 · accept 双路径与零写入红线', () => {
  it('accept ocr → status=accepted + 入口 /intake/drug；drugs/plans/health_profiles 零写入', async () => {
    const ask = await req('POST', '/api/consult', { question: '布洛芬能一起吃吗', drugIds: [] })
    const id = ask.body.suggestion.id as string
    const before = await userDomainCounts()

    const res = await req('POST', `/api/consult/suggestions/${id}/accept`, { path: 'ocr' })
    expect(res.status).toBe(200)
    expect(res.body.path).toBe('ocr')
    expect(res.body.target).toBe('/intake/drug')

    const after = await userDomainCounts()
    expect(after).toEqual(before) // 零写入红线：accept 不产生任何业务表写入
    const [row] = await db.select().from(consultSuggestions).where(eq(consultSuggestions.userId, USER))
    expect(row.status).toBe('accepted')
    expect(row.actedAt).toBeTruthy()
  })

  it('accept manual → 入口 /box?manual=1&prefillDrug=…；同样零写入', async () => {
    const ask = await req('POST', '/api/consult', { question: '布洛芬能一起吃吗', drugIds: [] })
    const before = await userDomainCounts()

    const res = await req('POST', `/api/consult/suggestions/${ask.body.suggestion.id}/accept`, { path: 'manual' })
    expect(res.status).toBe(200)
    expect(res.body.target).toBe(`/box?manual=1&prefillDrug=${encodeURIComponent('布洛芬片')}`)

    expect(await userDomainCounts()).toEqual(before)
  })

  it('重复 accept → 409；跨用户 accept → 404', async () => {
    const ask = await req('POST', '/api/consult', { question: '布洛芬能一起吃吗', drugIds: [] })
    const id = ask.body.suggestion.id as string
    await req('POST', `/api/consult/suggestions/${id}/accept`, { path: 'ocr' })

    const again = await req('POST', `/api/consult/suggestions/${id}/accept`, { path: 'manual' })
    expect(again.status).toBe(409)

    // 他人（p-002）名下的卡，p-001 不可见
    await db.insert(consultSuggestions).values({
      id: 'csug-other',
      userId: OTHER_USER,
      sessionId: 'csess-other',
      consultLogId: 'clog-other',
      type: 'add_drug',
      payload: { drugName: '布洛芬片' },
    })
    const cross = await req('POST', '/api/consult/suggestions/csug-other/accept', { path: 'ocr' })
    expect(cross.status).toBe(404)
  })
})

describe('建议卡集成 · dismiss 不复弹 + 每会话 ≤3 频控', () => {
  it('dismiss 后同问题再问 → 不再弹卡', async () => {
    const first = await req('POST', '/api/consult', { question: '布洛芬能一起吃吗', drugIds: [] })
    expect(first.body.suggestion.type).toBe('add_drug')
    const dis = await req('POST', `/api/consult/suggestions/${first.body.suggestion.id}/dismiss`)
    expect(dis.status).toBe(200)

    // 复弹：本会话（续问）内不再弹
    const second = await req('POST', '/api/consult', {
      question: '布洛芬能一起吃吗',
      drugIds: [],
      sessionId: first.body.sessionId,
    })
    expect(second.body.suggestion).toBeNull()
  })

  it('每会话 ≤3：会话内第 4 种药不再弹卡', async () => {
    // 直接落 3 张 pending 卡模拟已达上限（等价于会话内已弹过 3 次）
    const session = await req('POST', '/api/consult', { question: '我今天有点头晕', drugIds: [] }) // 建会话
    const sessionId = session.body.sessionId
    const log = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER)).limit(1)
    for (let i = 1; i <= 3; i++) {
      await db.insert(consultSuggestions).values({
        id: `csug-cap-${i}`,
        userId: USER,
        sessionId,
        consultLogId: log[0].id,
        type: 'add_drug',
        payload: { drugName: `已弹过的药${i}` },
      })
    }
    const res = await req('POST', '/api/consult', {
      question: '布洛芬能一起吃吗',
      drugIds: [],
      sessionId,
    })
    expect(res.status).toBe(200)
    expect(res.body.suggestion).toBeNull() // 超限 → add_drug 抑制（问题无不适词 → 也不落 note_symptom）
  })
})
