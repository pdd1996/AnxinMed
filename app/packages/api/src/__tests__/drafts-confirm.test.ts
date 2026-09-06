/**
 * M2-T6b · 草稿确认/拒绝事务集成测试（app.request()，跑独立测试库）。
 *
 * 完成标准「confirm 事务测试（写四表 + 中途失败回滚不留脏数据）」：
 *   - 成功：单事务写 drugs+plans+sources+health_profiles + drafts.status=confirmed + 确认留痕（keyFieldsSnapshot/method）；
 *   - 回滚：plans 写入非法日期触发 DB 错误 → 整个事务回滚，四表行数不变、draft 仍 pending（无脏数据）；
 *   - 入口B 建档（无计划）→ 只写 drugs+sources，无 plans 行；
 *   - reject → status=rejected 留痕；防重复 confirm → 409；跨用户/不存在 → 404；入参校验 → 400。
 * 直接播种 pending 草稿（聚焦事务，不依赖管线；管线由 pipeline-run/intake-api 覆盖）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { drugMaster, packageInserts, drafts, drugs, plans, sources, healthProfiles } from '../db/schema.js'
import * as draftsRepo from '../repositories/drafts.repo.js'

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
const OTHER = 'p-002'
const DM_HYCOSAN = 'dm-t6b-hycosan'
const PI_HYCOSAN = 'pi-t6b-hycosan'

const rxPayload = {
  entry: 'A',
  type: 'prescription',
  layers: ['处方层'],
  whitelist: {
    hospital: '萧山区第二人民医院',
    prescriptionNo: 'RX20260902001',
    date: '2026-09-02',
    department: '眼科',
    diagnosis: '干眼综合征',
    items: [{ drugName: '玻璃酸钠滴眼液', specification: '0.1%（10mL:10mg）', quantity: '1支', usage: '用法：滴眼 每次1滴 每日4次 共7天' }],
  },
  needsManual: [],
  sanitizeAudit: { 手机号: 1 },
  bodyImageRef: null,
  prescriptionNo: 'RX20260902001',
  planDraft: { tags: { dose: 'transcribed', frequency: 'transcribed', times: 'assist', startDate: 'default' } },
  drugDraft: { genericName: '玻璃酸钠滴眼液', drugMasterId: DM_HYCOSAN },
  conflicts: [],
  healthSuggestions: [{ field: '诊断', value: '干眼综合征', source: '处方笺抄录' }],
  interactions: { hits: [], coverageNote: null },
  dosageRange: { status: 'none', issues: [] },
  degraded: null,
}
const drugPayload = {
  entry: 'B',
  type: 'drug',
  layers: ['药盒原装层'],
  labelNotice: false,
  needsManual: [],
  drugDraft: { genericName: '玻璃酸钠滴眼液', drugMasterId: DM_HYCOSAN },
  planDraft: null,
  conflicts: [],
  healthSuggestions: [],
  interactions: { hits: [], coverageNote: null },
  dosageRange: { status: 'none', issues: [] },
  degraded: null,
}

async function seedDraft(id: string, type: 'prescription' | 'drug', payload: unknown, userId = USER) {
  await db.insert(drafts).values({ id, userId, type, status: 'pending', payload })
}

async function counts() {
  const [d, p, s, h] = await Promise.all([
    db.select().from(drugs).where(eq(drugs.userId, USER)),
    db.select().from(plans).where(eq(plans.userId, USER)),
    db.select().from(sources).where(eq(sources.userId, USER)),
    db.select().from(healthProfiles).where(eq(healthProfiles.userId, USER)),
  ])
  return { drugs: d.length, plans: p.length, sources: s.length, health: h.length }
}

async function cleanUser() {
  await db.delete(drafts).where(eq(drafts.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))
  await db.delete(sources).where(eq(sources.userId, USER))
  await db.delete(healthProfiles).where(eq(healthProfiles.userId, USER))
}

beforeAll(async () => {
  await cleanUser()
  await db.delete(drafts).where(eq(drafts.userId, OTHER))
  await db.insert(drugMaster).values({ id: DM_HYCOSAN, genericName: '玻璃酸钠滴眼液', specification: '0.1%（10mL:10mg）', form: '滴眼液' })
  // 说明书 fixture：上限 10 次/日 → 确认路径重跑范围校验的锚点（频次 4 → pass；99 → exceed）
  await db.insert(packageInserts).values({
    id: PI_HYCOSAN,
    drugId: DM_HYCOSAN,
    genericName: '玻璃酸钠滴眼液',
    dosage: { adult: { dosePerUse: { value: 1, unit: '滴' }, maxFrequencyPerDay: { value: 10, unit: '次', note: '超出需眼科医生指导' } } },
    source: '海露说明书',
    version: 'v1',
  })
})

afterAll(async () => {
  await cleanUser()
  await db.delete(drafts).where(eq(drafts.userId, OTHER))
  await db.delete(packageInserts).where(eq(packageInserts.id, PI_HYCOSAN))
  await db.delete(drugMaster).where(eq(drugMaster.id, DM_HYCOSAN))
})

describe('POST /api/drafts/:id/confirm · 单事务原子写四表', () => {
  it('入口A（带计划 + 健康勾选）→ 四表写入 + status=confirmed + 留痕；用户修正字段标 user', async () => {
    const id = 'draft-t6b-confirm-a'
    await seedDraft(id, 'prescription', rxPayload)
    const res = await req('POST', `/api/drafts/${id}/confirm`, {
      drug: { genericName: '玻璃酸钠滴眼液', brandName: '海露', specification: '0.1%（10mL:10mg）', form: '滴眼液', drugMasterId: DM_HYCOSAN, confirmStatus: 'transcribed' },
      plan: { dose: { value: 1, unit: '滴' }, frequency: 4, times: ['08:00', '12:00', '16:00', '20:00'], route: '滴眼', cycleType: 'closed', startDate: '2026-09-02', endDate: '2026-09-09', tags: { dose: 'user', frequency: 'transcribed', times: 'assist', startDate: 'default', endDate: 'derived' } },
      health: [{ fieldKey: '诊断', value: '干眼综合征' }],
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'confirmed' })
    const { drugId, planId, sourceId } = res.body

    const drugRows = await db.select().from(drugs).where(eq(drugs.id, drugId))
    expect(drugRows[0]).toMatchObject({ genericName: '玻璃酸钠滴眼液', confirmStatus: 'transcribed', drugMasterId: DM_HYCOSAN, sourceId })

    const planRows = await db.select().from(plans).where(eq(plans.id, planId))
    expect(planRows[0]).toMatchObject({ drugId, frequency: 4, status: 'active', source: 'prescription', sourceId, startDate: '2026-09-02' })
    expect((planRows[0].tags as any).dose).toBe('user') // 用户修正的用量标 user
    expect(planRows[0].itemId).toBe(id) // 反查来源内条目（PRD §7.3.1）：草稿即条目单元

    const srcRows = await db.select().from(sources).where(eq(sources.id, sourceId))
    expect(srcRows[0].type).toBe('prescription')
    expect(srcRows[0].prescriptionNo).toBe('RX20260902001')
    expect((srcRows[0].confirmTrace as any)).toMatchObject({ method: '处方抄录确认', draftId: id })
    expect((srcRows[0].confirmTrace as any).keyFieldsSnapshot).toMatchObject({ 药名: '玻璃酸钠滴眼液', 用量: '1 滴', 频次: '每日 4 次' })
    expect((srcRows[0].whitelistFields as any).diagnosis).toBe('干眼综合征')
    expect((srcRows[0].sanitizeAudit as any)).toMatchObject({ 手机号: 1 })

    const hRows = await db.select().from(healthProfiles).where(and(eq(healthProfiles.userId, USER), eq(healthProfiles.fieldKey, '诊断')))
    expect(hRows[0].value).toBe('干眼综合征')
    expect((hRows[0].sourceMeta as any).source).toBe('prescription_confirmed')

    const dRows = await db.select().from(drafts).where(eq(drafts.id, id))
    expect(dRows[0].status).toBe('confirmed')

    // 确认路径对**最终值**重跑规则检查（M2 收尾清单：接入建计划与确认两条路径）：4 次/日 ≤ 10 → pass
    expect(res.body.dosageRange.status).toBe('pass')
    expect(res.body.interactions).toMatchObject({ hits: [], coverageNote: null })
  })

  it('入口B（建档，无计划）→ 只写 drugs+sources（type=drug_box），无 plans 行', async () => {
    const id = 'draft-t6b-confirm-b'
    await seedDraft(id, 'drug', drugPayload)
    const res = await req('POST', `/api/drafts/${id}/confirm`, {
      drug: { genericName: '玻璃酸钠滴眼液', specification: '0.1%', form: '滴眼液', drugMasterId: DM_HYCOSAN, confirmStatus: 'ocr_matched' },
    })
    expect(res.status).toBe(200)
    expect(res.body.planId).toBeNull()
    const srcRows = await db.select().from(sources).where(eq(sources.id, res.body.sourceId))
    expect(srcRows[0].type).toBe('drug_box')
    const planRows = await db.select().from(plans).where(eq(plans.drugId, res.body.drugId))
    expect(planRows).toHaveLength(0)
  })

  it('中途失败（plans 非法日期 → DB 错误）→ 整个事务回滚：四表行数不变、无脏数据、draft 仍 pending', async () => {
    const id = 'draft-t6b-rollback'
    await seedDraft(id, 'prescription', rxPayload)
    const before = await counts()
    const res = await req('POST', `/api/drafts/${id}/confirm`, {
      drug: { genericName: '回滚测试药', confirmStatus: 'transcribed' },
      plan: { dose: { value: 1, unit: '片' }, frequency: 1, times: ['08:00'], cycleType: 'closed', startDate: '2026-13-45' }, // 非法日期 → PG 拒绝
      health: [{ fieldKey: '诊断', value: '回滚测试' }],
    })
    expect(res.status).toBe(500) // 非 ApiError 的 DB 错误 → onError INTERNAL
    const after = await counts()
    expect(after).toEqual(before) // 四表零增量（sources/drugs 已写入的也回滚）
    const stray = await db.select().from(drugs).where(and(eq(drugs.userId, USER), eq(drugs.genericName, '回滚测试药')))
    expect(stray).toHaveLength(0)
    const dRows = await db.select().from(drafts).where(eq(drafts.id, id))
    expect(dRows[0].status).toBe('pending') // 状态未翻转
  })

  it('对已确认草稿再次 confirm → 409 CONFLICT（防重复）', async () => {
    const id = 'draft-t6b-double'
    await seedDraft(id, 'drug', drugPayload)
    const first = await req('POST', `/api/drafts/${id}/confirm`, { drug: { genericName: '双次测试药', confirmStatus: 'ocr_matched' } })
    expect(first.status).toBe(200)
    const second = await req('POST', `/api/drafts/${id}/confirm`, { drug: { genericName: '双次测试药', confirmStatus: 'ocr_matched' } })
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('CONFLICT')
  })
})

describe('POST /api/drafts/:id/reject', () => {
  it('reject → status=rejected + rejectReason 留痕', async () => {
    const id = 'draft-t6b-reject'
    await seedDraft(id, 'drug', drugPayload)
    const res = await req('POST', `/api/drafts/${id}/reject`, { reason: '这不是我的药' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'rejected' })
    const rows = await db.select().from(drafts).where(eq(drafts.id, id))
    expect(rows[0].status).toBe('rejected')
    expect((rows[0].payload as any).rejectReason).toBe('这不是我的药')
  })

  it('对已拒绝草稿再 reject → 409 CONFLICT', async () => {
    const id = 'draft-t6b-reject'
    const res = await req('POST', `/api/drafts/${id}/reject`, { reason: '再次' })
    expect(res.status).toBe(409)
  })
})

describe('草稿确认的守卫分支', () => {
  it('confirm 不存在的草稿 → 404 NOT_FOUND', async () => {
    const res = await req('POST', '/api/drafts/draft-does-not-exist/confirm', { drug: { genericName: 'X', confirmStatus: 'manual' } })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  it('跨用户草稿（p-002 的）→ p-001 confirm 得 404（多用户边界，不越权）', async () => {
    const id = 'draft-t6b-other-user'
    await seedDraft(id, 'drug', drugPayload, OTHER)
    const res = await req('POST', `/api/drafts/${id}/confirm`, { drug: { genericName: 'X', confirmStatus: 'manual' } })
    expect(res.status).toBe(404)
  })

  it('confirm 入参缺 drug.genericName → 400 VALIDATION', async () => {
    const id = 'draft-t6b-validation'
    await seedDraft(id, 'drug', drugPayload)
    const res = await req('POST', `/api/drafts/${id}/confirm`, { drug: { confirmStatus: 'manual' } })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION')
  })
})

describe('确认路径的规则检查与溯源守卫（review 修复）', () => {
  it('最终确认值超标（99 次/日 > 说明书上限 10）→ 仍 200 落库，dosageRange=exceed 只标注不阻止', async () => {
    const id = 'draft-t6b-exceed'
    await seedDraft(id, 'prescription', rxPayload)
    const res = await req('POST', `/api/drafts/${id}/confirm`, {
      drug: { genericName: '玻璃酸钠滴眼液', drugMasterId: DM_HYCOSAN, confirmStatus: 'transcribed' },
      plan: { dose: { value: 1, unit: '滴' }, frequency: 99, times: ['08:00'], cycleType: 'open', startDate: '2026-09-02' },
    })
    expect(res.status).toBe(200)
    expect(res.body.dosageRange.status).toBe('exceed')
    expect(res.body.dosageRange.issues[0]).toMatchObject({ field: 'frequency', planValue: '99 次/日', insertMax: '10 次/日' })
    const planRows = await db.select().from(plans).where(eq(plans.id, res.body.planId))
    expect(planRows).toHaveLength(1) // 超标不阻止创建（PRD §8.3）
  })

  it('health 字段不在草稿建议清单内 → 400（防伪造 prescription_confirmed 溯源），draft 仍 pending', async () => {
    const id = 'draft-t6b-health-forge'
    await seedDraft(id, 'prescription', rxPayload)
    const res = await req('POST', `/api/drafts/${id}/confirm`, {
      drug: { genericName: '玻璃酸钠滴眼液', confirmStatus: 'transcribed' },
      health: [{ fieldKey: '过敏史', value: '无' }], // 建议清单只有「诊断」
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION')
    expect(res.body.message).toContain('建议清单')
    const rows = await db.select().from(drafts).where(eq(drafts.id, id))
    expect(rows[0].status).toBe('pending') // 校验在事务前，无任何写入
  })

  it('health 勾选值被用户改过 → 来源标 self_reported（非 prescription_confirmed，溯源诚实）', async () => {
    const id = 'draft-t6b-health-edited'
    await seedDraft(id, 'prescription', rxPayload)
    const res = await req('POST', `/api/drafts/${id}/confirm`, {
      drug: { genericName: '玻璃酸钠滴眼液', confirmStatus: 'transcribed' },
      health: [{ fieldKey: '诊断', value: '干眼症（用户修正）' }], // ≠ 建议值「干眼综合征」
    })
    expect(res.status).toBe(200)
    const hRows = await db.select().from(healthProfiles).where(and(eq(healthProfiles.userId, USER), eq(healthProfiles.fieldKey, '诊断')))
    expect(hRows[0].value).toBe('干眼症（用户修正）')
    expect((hRows[0].sourceMeta as any).source).toBe('self_reported')
  })

  it('入口B 草稿带计划（必为用户手填）→ 医嘱字段强制标 user，客户端传 transcribed 无效；source=manual', async () => {
    const id = 'draft-t6b-b-with-plan'
    await seedDraft(id, 'drug', drugPayload)
    const res = await req('POST', `/api/drafts/${id}/confirm`, {
      drug: { genericName: '玻璃酸钠滴眼液', drugMasterId: DM_HYCOSAN, confirmStatus: 'ocr_matched' },
      plan: { dose: { value: 1, unit: '滴' }, frequency: 2, times: ['08:00', '20:00'], cycleType: 'open', startDate: '2026-09-02', tags: { dose: 'transcribed', frequency: 'transcribed' } },
    })
    expect(res.status).toBe(200)
    const planRows = await db.select().from(plans).where(eq(plans.id, res.body.planId))
    expect(planRows[0].source).toBe('manual')
    expect((planRows[0].tags as any).dose).toBe('user') // 药盒来源计划上绝不允许「抄录」语义
    expect((planRows[0].tags as any).frequency).toBe('user')
    expect((planRows[0].tags as any).duration).toBe('user')
  })

  it('resolveDraft 竞态守卫：仅 pending 可落定，二次落定返回 undefined（事务内据此 409 回滚）', async () => {
    const id = 'draft-t6b-race'
    await seedDraft(id, 'drug', drugPayload)
    const first = await draftsRepo.resolveDraft(USER, id, 'confirmed')
    expect(first?.status).toBe('confirmed')
    const second = await draftsRepo.resolveDraft(USER, id, 'rejected')
    expect(second).toBeUndefined() // WHERE status='pending' 未命中 → 不覆盖已落定状态
  })
})
