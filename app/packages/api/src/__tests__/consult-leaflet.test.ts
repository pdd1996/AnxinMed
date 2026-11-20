/**
 * 2026-11-20：说明书分段落页接口 + 说明书问句回归。
 *
 * 覆盖：
 * - GET /api/drugs/:id/leaflet：分段原文、用法用量固定提示、未核验提示、越权/未收录 404；
 * - 回归：「这个药品说明书有吗」不再走已移除的「说明书可用性」专用卡，回到 S1 说明书管线。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { consultLogs, drugMaster, drugs, packageInserts, riskEvents } from '../db/schema.js'
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

const USER = 'p-001'
const OTHER_USER = 'p-002'
const DM = 'dm-leaflet-test'
const PI = 'pi-leaflet-test'
const DRUG = 'drug-leaflet-test'
const DRUG_NO_INSERT = 'drug-leaflet-no-insert'
const DRUG_FOREIGN = 'drug-leaflet-foreign'

let prevClients: AiClients | null = null

const SOURCE_SECTIONS = {
  适应症: '用于缓解干眼症状，如眼睛干涩、异物感、疲劳等。',
  用法用量: '每日 3 次，每次 1 滴，疗程 7 天。',
  禁忌: '对玻璃酸钠过敏者禁用。',
  注意事项:
    '·1.开封后一个月内使用，避免瓶口接触眼睛或皮肤。\n·2.使用后如出现眼痛、视力下降，请立即就医。',
  不良反应: '偶见眼部刺激感、异物感。',
  生产企业: '演示药业有限公司',
}

beforeAll(async () => {
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(drugs).where(inArray(drugs.userId, [USER, OTHER_USER]))

  await db.insert(drugMaster).values({
    id: DM,
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%（10mL:10mg）',
    form: '滴眼液',
    approvalNumbers: ['国药准字H20240001'],
  })
  await db.insert(packageInserts).values({
    id: PI,
    curationStatus: 'reviewed',
    drugId: DM,
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    specification: '0.1%（10mL:10mg）',
    form: '滴眼液',
    indication: '用于缓解干眼症状，如眼睛干涩、异物感、疲劳等。',
    contraindications: ['对玻璃酸钠过敏者禁用。'],
    precautions: ['开封后一个月内使用', '避免瓶口接触眼睛或皮肤'],
    adverseReactions: '偶见眼部刺激感、异物感。',
    source: '说明书 PDF（本地资料库，PDF 批次 2026-10-19）',
    version: 'nmpa-YBH00000000',
    approvalNumbers: ['国药准字H20240001'],
    sourceSections: SOURCE_SECTIONS,
  })
  await db.insert(drugs).values([
    {
      id: DRUG,
      userId: USER,
      genericName: '玻璃酸钠滴眼液',
      brandName: '海露',
      specification: '0.1%（10mL:10mg）',
      form: '滴眼液',
      drugMasterId: DM,
      confirmStatus: 'ocr_matched',
    },
    {
      id: DRUG_NO_INSERT,
      userId: USER,
      genericName: '本地未收录测试药',
      drugMasterId: 'dm-not-exist',
      confirmStatus: 'ocr_matched',
    },
    {
      id: DRUG_FOREIGN,
      userId: OTHER_USER,
      genericName: '玻璃酸钠滴眼液',
      drugMasterId: DM,
      confirmStatus: 'ocr_matched',
    },
  ])
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(drugs).where(inArray(drugs.userId, [USER, OTHER_USER]))
  await db.delete(packageInserts).where(eq(packageInserts.id, PI))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM))
})

beforeEach(async () => {
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
})

afterEach(async () => {
  await db.update(packageInserts).set({ curationStatus: 'reviewed' }).where(eq(packageInserts.id, PI))
})

// ---------------------------------------------------------------------------
// 说明书可用性意图已按用户裁定移除（2026-11-20）：问「说明书有吗」回到 S1 说明书管线
// ---------------------------------------------------------------------------

describe('POST /api/consult · 说明书问句（可用性意图已移除）', () => {
  it('「这个药品说明书有吗」→ 不再返回可用性专用卡，走 S1 说明书管线（1 次 LLM）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(
      mockClients({
        calls,
        consult: {
          summary: '对玻璃酸钠过敏者禁用。',
          keyPoints: [],
          risks: [],
          nextAction: '如有疑问，请咨询医生或药师。',
          warning: '不要根据 AI 回答自行调整处方。',
        },
      }),
    )

    const res = await req('POST', '/api/consult', {
      question: '这个药品说明书有吗',
      drugIds: [DRUG],
    })

    expect(res.status).toBe(200)
    // 不再有「已收录…」的确定性可用性回答；回到 S1 管线（mock 模型输出）
    expect(res.body.sections.summary).toBe('对玻璃酸钠过敏者禁用。')
    expect(res.body.sections.summary).not.toContain('已收录')
    expect(calls.consultAnswer).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 说明书分段页接口（GET /api/drugs/:id/leaflet）
// ---------------------------------------------------------------------------

describe('GET /api/drugs/:id/leaflet · 分段落原文', () => {
  it('已核验：返回身份/来源/分段；用法用量固定为医嘱提示（不含剂量数字）', async () => {
    const res = await req('GET', `/api/drugs/${DRUG}/leaflet`)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    const leaflet = res.body.leaflet
    expect(leaflet.drugId).toBe(DRUG)
    expect(leaflet.reviewed).toBe(true)
    expect(leaflet.notice).toBeNull()
    expect(leaflet.approvalNumbers).toEqual(['国药准字H20240001'])

    const byKey = Object.fromEntries(leaflet.sections.map((s: any) => [s.key, s]))
    expect(byKey.indication.body).toContain('缓解干眼症状')
    expect(byKey.contraindication.body).toContain('过敏者禁用')
    expect(byKey.dosage.body).toContain('医嘱范畴')
    expect(byKey.dosage.body).not.toMatch(/\d+\s*(mg|毫升|片|滴)/)
    expect(leaflet.sections.map((s: any) => s.key)).toContain('precautions')
  })

  it('未核验：notice 非空 + reviewed=false（前端顶部 banner）', async () => {
    await db.update(packageInserts).set({ curationStatus: 'crawled' }).where(eq(packageInserts.id, PI))

    const res = await req('GET', `/api/drugs/${DRUG}/leaflet`)

    expect(res.status).toBe(200)
    expect(res.body.leaflet.reviewed).toBe(false)
    expect(res.body.leaflet.notice).toContain('尚未人工核验')
  })

  it('本地未收录 → 404（可见失败，不静默）', async () => {
    const res = await req('GET', `/api/drugs/${DRUG_NO_INSERT}/leaflet`)
    expect(res.status).toBe(404)
    expect(res.body.ok).toBe(false)
    expect(res.body.message).toContain('未收录')
  })

  it('别的用户的药 → 404（userId 隔离，不泄漏存在性）', async () => {
    const res = await req('GET', `/api/drugs/${DRUG_FOREIGN}/leaflet`)
    expect(res.status).toBe(404)
  })
})
