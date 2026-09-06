/**
 * M2-T6 · intake / drafts API 集成测试（app.request()，跑独立测试库；AI 全 mock 经 registry 注入）。
 *
 * 覆盖：detect 信息性返回；prescription 单/多条目落 N 份草稿 + GET 详情；drug 建档（labelNotice）；
 * 409 LAYER_MISMATCH / 422 UNSUPPORTED_OBJECT / 503 AI_UNAVAILABLE / 400 VALIDATION / 404 NOT_FOUND 分支。
 * 测试库 globalSetup 只 seed users，故本文件自建 drug_master 候选，afterAll 清理（不污染其它测试）。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { drugMaster, drafts } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import { createAiClients } from '../lib/ai/index.js'
import { AIUnavailableError } from '../lib/ai/types.js'
import { IMG_DATAURL, mkOcr, mockClients } from './helpers/ai-mocks.js'

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
const DM_HYCOSAN = 'dm-t6-hycosan'
const DM_LEVO = 'dm-t6-levo'

const HEADER = [
  '萧山区第二人民医院（演示合成处方笺）',
  '处方号：RX20260902001',
  '日期：2026-09-02  科室：眼科',
  '临床诊断：干眼综合征',
]
const RX = [...HEADER, 'Rp', '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支', '用法：滴眼 每次1滴 每日4次 共7天', '处方完毕']
const RX2 = [
  ...HEADER,
  'Rp',
  '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支',
  '用法：滴眼 每次1滴 每日4次 共7天',
  '左氧氟沙星滴眼液 0.5%（5mL：24.4mg） ×1支',
  '用法：滴眼 每次1滴 每日3次 共5天',
  '处方完毕',
]
const IDENTITY = { genericName: '玻璃酸钠滴眼液', brandName: '海露', specification: '0.1%（10mL：10mg）', form: '滴眼液' }

beforeAll(async () => {
  await db.delete(drafts).where(eq(drafts.userId, USER))
  await db.insert(drugMaster).values([
    { id: DM_HYCOSAN, genericName: '玻璃酸钠滴眼液', specification: '0.1%（10mL:10mg）', form: '滴眼液' },
    { id: DM_LEVO, genericName: '左氧氟沙星滴眼液', specification: '0.5%（5mL:24.4mg）', form: '滴眼液' },
  ])
})

afterAll(async () => {
  await db.delete(drafts).where(eq(drafts.userId, USER))
  await db.delete(drugMaster).where(inArray(drugMaster.id, [DM_HYCOSAN, DM_LEVO]))
})

afterEach(() => setAiClients(createAiClients())) // 还原注入接缝，避免泄漏到其它用例

describe('POST /api/intake/detect', () => {
  it('仅层检测：返回 layers + unsupported + 入口建议（不落库）', async () => {
    setAiClients(mockClients({ layers: ['处方层'] }))
    const res = await req('POST', '/api/intake/detect', { image: IMG_DATAURL, entry: 'A' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.layers).toEqual(['处方层'])
    expect(res.body.unsupported).toBe(false)
    expect(res.body.mismatch).toBeNull()
  })
})

describe('POST /api/intake/prescription', () => {
  it('单条目处方笺 → 201，落 1 份草稿；GET /api/drafts/:id 返回 payload', async () => {
    setAiClients(mockClients({ layers: ['处方层'], ocr: mkOcr(RX), identity: IDENTITY }))
    const res = await req('POST', '/api/intake/prescription', { image: IMG_DATAURL })
    expect(res.status).toBe(201)
    expect(res.body.draftIds).toHaveLength(1)
    expect(res.body.drafts[0]).toMatchObject({ type: 'prescription', matchStatus: 'unique', drugName: '玻璃酸钠滴眼液' })

    const id = res.body.draftIds[0] as string
    // DB 落库校验
    const rows = await db.select().from(drafts).where(eq(drafts.id, id))
    expect(rows[0].status).toBe('pending')
    expect(rows[0].type).toBe('prescription')

    const got = await req('GET', `/api/drafts/${id}`)
    expect(got.status).toBe(200)
    expect(got.body.draft.payload.planDraft).toMatchObject({ dose: { value: 1, unit: '滴' }, frequency: 4, cycleType: 'closed' })
    expect(got.body.draft.payload.drugDraft.drugMasterId).toBe(DM_HYCOSAN)
  })

  it('多条目处方笺 → 拆 N 份草稿落库（PRD §7.2.1）', async () => {
    setAiClients(mockClients({ layers: ['处方层'], ocr: mkOcr(RX2), identity: IDENTITY }))
    const res = await req('POST', '/api/intake/prescription', { image: IMG_DATAURL })
    expect(res.status).toBe(201)
    expect(res.body.draftIds).toHaveLength(2)
    const masters = res.body.drafts.map((d: any) => d.drugName).sort()
    expect(masters).toEqual(['左氧氟沙星滴眼液', '玻璃酸钠滴眼液'].sort())
  })

  it('层检测与入口A不符（药盒层）→ 409 LAYER_MISMATCH，带 detected + suggestion', async () => {
    setAiClients(mockClients({ layers: ['药盒原装层'], identity: IDENTITY }))
    const res = await req('POST', '/api/intake/prescription', { image: IMG_DATAURL })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ ok: false, code: 'LAYER_MISMATCH' })
    expect(res.body.detected).toEqual(['药盒原装层'])
    expect(String(res.body.suggestion)).toContain('切换到「拍药品」')
  })

  it('detectLayers 不可用 → 503 AI_UNAVAILABLE（引导手动建档）', async () => {
    setAiClients(mockClients({ detectLayersError: new AIUnavailableError('qwen', 'down') }))
    const res = await req('POST', '/api/intake/prescription', { image: IMG_DATAURL })
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('AI_UNAVAILABLE')
  })

  it('非法图片（非 dataURL）→ 400 VALIDATION', async () => {
    setAiClients(mockClients({ layers: ['处方层'] }))
    const res = await req('POST', '/api/intake/prescription', { image: 'not-a-data-url' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION')
  })
})

describe('POST /api/intake/drug', () => {
  it('药盒原装层 → 201，1 份建档草稿，payload 无 planDraft（无用法用量）', async () => {
    setAiClients(mockClients({ layers: ['药盒原装层'], identity: IDENTITY }))
    const res = await req('POST', '/api/intake/drug', { image: IMG_DATAURL })
    expect(res.status).toBe(201)
    expect(res.body.draftIds).toHaveLength(1)
    const id = res.body.draftIds[0] as string
    const got = await req('GET', `/api/drafts/${id}`)
    expect(got.body.draft.payload.type).toBe('drug')
    expect(got.body.draft.payload.planDraft).toBeNull()
    expect(got.body.draft.payload.labelNotice).toBeFalsy()
    expect(got.body.draft.payload.drugDraft.drugMasterId).toBe(DM_HYCOSAN)
  })

  it('医院标签层 → labelNotice:true（标签用法不自动抄录）', async () => {
    setAiClients(mockClients({ layers: ['医院标签层', '药盒原装层'], identity: IDENTITY }))
    const res = await req('POST', '/api/intake/drug', { image: IMG_DATAURL })
    const id = res.body.draftIds[0] as string
    const got = await req('GET', `/api/drafts/${id}`)
    expect(got.body.draft.payload.labelNotice).toBe(true)
    expect(got.body.draft.payload.planDraft).toBeNull()
  })

  it('不支持对象（散装药片）→ 422 UNSUPPORTED_OBJECT + 安全提示', async () => {
    setAiClients(mockClients({ layers: ['不支持'] }))
    const res = await req('POST', '/api/intake/drug', { image: IMG_DATAURL })
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('UNSUPPORTED_OBJECT')
    expect(res.body.message).toContain('手动建档')
    expect(res.body.detected).toEqual(['不支持'])
  })
})

describe('GET /api/drafts/:id', () => {
  it('不存在的草稿 → 404 NOT_FOUND', async () => {
    const res = await req('GET', '/api/drafts/draft-does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })
})
