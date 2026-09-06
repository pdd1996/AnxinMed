/**
 * M3-T5 · 全链路降级演练（spec §T5.2）——逐个 kill Qwen / OCR / Baichuan（注入 AIUnavailableError，
 * 等价「改 env 指向坏地址」→ 客户端调用失败），产出「每个模型一条」共三条记录，断言：
 *   ① 药箱 / 计划 / 今日任务 / 记录（无 AI 依赖）全功能可用；
 *   ② 录入 / 咨询给可理解错误（语义化 AI_UNAVAILABLE 或降级草稿/离线兜底），不静默；
 *   ③ 无 5xx 雪崩——除录入入口硬闸门的语义化 503 外，其余全 200/201。
 *
 * 用 registry.setAiClients 注入 mock（管线/编排/降级/事务/API 全走真代码，只冻结模型 I/O）。
 * 咨询侧 Baichuan 降级的细粒度断言见 consult-api.test.ts；本文件聚焦「三模型 × 全功能面」的演练矩阵。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { todayStr } from '@anxin/shared'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { consultLogs, drugMaster, drugs, drafts, packageInserts, plans, records, riskEvents } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import { createAiClients } from '../lib/ai/index.js'
import { AIUnavailableError } from '../lib/ai/types.js'
import { mockClients, mkOcr, IMG_DATAURL } from './helpers/ai-mocks.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

/** 模拟「kill 某模型」：客户端调用抛 AIUnavailableError（等价 env 指向坏地址后 callJson 失败）。 */
const kill = (client: 'qwen' | 'ocr' | 'baichuan') => new AIUnavailableError(client, `${client} 指向坏地址（演练 kill）`)

const USER = 'p-001'
const DM = 'dm-t5-degrade'
const PI = 'pi-t5-degrade'
const DRUG = 'drug-t5-degrade'
const PLAN = 'plan-t5-degrade'

const HEADER = [
  '萧山区第二人民医院（演示合成处方笺）',
  '处方号：RX20260902001',
  '日期：2026-09-02  科室：眼科',
  '临床诊断：干眼综合征',
]
const RX = [...HEADER, 'Rp', '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支', '用法：滴眼 每次1滴 每日4次 共7天', '处方完毕']
const IDENTITY = { genericName: '玻璃酸钠滴眼液', brandName: '海露', specification: '0.1%（10mL：10mg）', form: '滴眼液' }
const CONSULT_OK = {
  summary: '玻璃酸钠滴眼液用于缓解干眼症状',
  keyPoints: ['保湿润滑作用'],
  risks: [],
  nextAction: '如症状持续请咨询眼科医生',
  warning: '不要自行调整处方',
}

beforeAll(async () => {
  await db.insert(drugMaster).values({ id: DM, genericName: '玻璃酸钠滴眼液', brandName: '海露', specification: '0.1%（10mL:10mg）', form: '滴眼液' })
  await db.insert(packageInserts).values({
    id: PI,
    drugId: DM,
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%（10mL:10mg）',
    form: '滴眼液',
    indication: '用于缓解干眼症状',
    dosage: { adult: { dosePerUse: { value: 1, unit: '滴' }, maxFrequencyPerDay: { value: 10, unit: '次' } } },
    source: '丁香园用药助手（演示抄录）',
    version: '2024-01',
  })
  await db.insert(drugs).values({ id: DRUG, userId: USER, genericName: '玻璃酸钠滴眼液', specification: '0.1%', form: '滴眼液', drugMasterId: DM, confirmStatus: 'ocr_matched' })
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
  setAiClients(createAiClients())
  await db.delete(records).where(eq(records.userId, USER))
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(drafts).where(eq(drafts.userId, USER))
  await db.delete(plans).where(eq(plans.id, PLAN))
  await db.delete(drugs).where(eq(drugs.id, DRUG))
  await db.delete(packageInserts).where(eq(packageInserts.id, PI))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM))
})

afterEach(async () => {
  setAiClients(createAiClients()) // 还原注入接缝
  // 清理本轮产生的草稿/留痕/记录，保证记录间互不干扰
  await db.delete(records).where(eq(records.userId, USER))
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(drafts).where(eq(drafts.userId, USER))
})

/** 核心功能面（无 AI 依赖）：药箱/计划/今日任务读 + 记录写，全部可用。 */
async function expectCoreFeaturesUp(): Promise<void> {
  expect((await req('GET', '/api/drugs')).status).toBe(200)
  expect((await req('GET', '/api/plans')).status).toBe(200)
  expect((await req('GET', '/api/tasks/today')).status).toBe(200)
  const rec = await req('POST', '/api/records', { planId: PLAN, date: todayStr(), time: '08:00', status: 'taken' })
  expect([200, 201]).toContain(rec.status) // 记录写入成功（非 5xx）
}

describe('降级演练 · 记录一：kill Qwen（层检测 / 身份线 VLM）', () => {
  it('录入入口硬闸门 → 语义化 503 AI_UNAVAILABLE（引导手动建档）；核心功能不受影响；咨询不依赖 qwen 仍 200', async () => {
    setAiClients(
      mockClients({ detectLayersError: kill('qwen'), extractIdentityError: kill('qwen'), ocr: mkOcr(RX), identity: IDENTITY, consult: CONSULT_OK }),
    )

    // 录入：detectLayers 是入口A/B 的硬闸门 → 冒泡 AIUnavailable → 503（唯一允许的 5xx，语义化）
    const rx = await req('POST', '/api/intake/prescription', { image: IMG_DATAURL })
    expect(rx.status).toBe(503)
    expect(rx.body).toMatchObject({ ok: false, code: 'AI_UNAVAILABLE' })
    expect(String(rx.body.message)).toContain('手动建档')
    const dg = await req('POST', '/api/intake/drug', { image: IMG_DATAURL })
    expect(dg.status).toBe(503)

    // 核心功能（药箱/计划/今日/记录）全可用
    await expectCoreFeaturesUp()

    // 咨询走 baichuan + 本地说明书，不依赖 qwen → 200 正常回答
    const cs = await req('POST', '/api/consult', { question: '这个药通常用于什么', drugIds: [DRUG] })
    expect(cs.status).toBe(200)
    expect(cs.body.riskLevel).toBe('L1')
  })
})

describe('降级演练 · 记录二：kill OCR（医嘱线 runOcr）', () => {
  it('录入A → 201 降级草稿（OCR_FAILED，全 needsManual），非 503 不炸整体；录入B 不用 OCR → 201；核心功能不受影响', async () => {
    // 入口A：qwen 在（层检测过），OCR 挂 → 转降级草稿（run.ts catch AIUnavailable → degradedDraft）
    setAiClients(mockClients({ layers: ['处方层'], runOcrError: kill('ocr'), identity: IDENTITY, consult: CONSULT_OK }))
    const rx = await req('POST', '/api/intake/prescription', { image: IMG_DATAURL })
    expect(rx.status).toBe(201) // 降级也是成功落草稿，不是 5xx
    const got = await req('GET', `/api/drafts/${rx.body.draftIds[0]}`)
    expect(got.body.draft.payload.degraded.code).toBe('OCR_FAILED')
    expect(got.body.draft.payload.needsManual).toContain('items')

    // 入口B（药盒）只走身份线，不用 OCR → 正常建档
    setAiClients(mockClients({ layers: ['药盒原装层'], runOcrError: kill('ocr'), identity: IDENTITY }))
    const dg = await req('POST', '/api/intake/drug', { image: IMG_DATAURL })
    expect(dg.status).toBe(201)

    await expectCoreFeaturesUp()
  })
})

describe('降级演练 · 记录三：kill Baichuan（兜底解析 / 咨询回答 / 摘要）', () => {
  it('咨询 → 200 离线兜底（notice「百川服务不可用」），非 5xx；录入A 完整处方不需兜底 → 201；核心功能不受影响', async () => {
    setAiClients(
      mockClients({ layers: ['处方层'], ocr: mkOcr(RX), identity: IDENTITY, fallbackError: kill('baichuan'), consultAnswerError: kill('baichuan') }),
    )

    // 咨询：baichuan 挂 → fallbackSectionsFromInsert 离线兜底（200 + notice），绝不 5xx
    const cs = await req('POST', '/api/consult', { question: '这个药通常用于什么', drugIds: [DRUG] })
    expect(cs.status).toBe(200)
    expect(cs.body.ok).toBe(true)
    expect(String(cs.body.notice)).toContain('百川服务不可用')

    // 录入A：RX 字段完整 → 不触发 fallbackParse（仅缺项才调）→ 201 正常
    const rx = await req('POST', '/api/intake/prescription', { image: IMG_DATAURL })
    expect(rx.status).toBe(201)
    expect(rx.body.drafts[0].degraded).toBeNull()

    await expectCoreFeaturesUp()
  })
})

describe('降级演练 · 无 5xx 雪崩（横切断言）', () => {
  it('三模型全 down：核心功能仍全 200/201，录入仅语义化 503，咨询 200 兜底', async () => {
    setAiClients(
      mockClients({ detectLayersError: kill('qwen'), extractIdentityError: kill('qwen'), runOcrError: kill('ocr'), fallbackError: kill('baichuan'), consultAnswerError: kill('baichuan') }),
    )
    await expectCoreFeaturesUp() // 药箱/计划/今日/记录：与模型无关，全可用
    expect((await req('POST', '/api/intake/prescription', { image: IMG_DATAURL })).status).toBe(503) // 唯一 5xx，语义化
    const cs = await req('POST', '/api/consult', { question: '这个药通常用于什么', drugIds: [DRUG] })
    expect(cs.status).toBe(200) // 咨询不 5xx
    // 资产域批量读也无 5xx
    for (const p of ['/api/drugs', '/api/plans', '/api/tasks/today', '/api/profile']) {
      const r = await req('GET', p)
      expect(r.status, p).toBeLessThan(500)
    }
  })
})
