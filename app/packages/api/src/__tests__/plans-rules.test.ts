/**
 * M2-T5 集成测试（app.request()，跑独立测试库）：POST /api/plans 接入规则引擎。
 * 完成标准「为已有生效计划的老药建新计划（续方）触发检查」：
 *   老药 A 生效 → 为 B 建计划 → 生效集合 {A,B} 命中相互作用规则；范围校验超标只标注不阻止。
 * 测试库 globalSetup 只 seed users（无资产域数据），故本文件自建 drug_master/interaction_rules/
 * package_inserts + 带 drugMasterId 的用户药 fixture，afterAll 清理（不污染其它测试）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { drugMaster, packageInserts, interactionRules, drugs, plans } from '../db/schema.js'

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
const DM_A = 'dm-t5-a'
const DM_B = 'dm-t5-b'
const DRUG_A = 'drug-t5-a'
const DRUG_B = 'drug-t5-b'
const IR = 'ir-t5-ab'
const PI_A = 'pi-t5-a'
const PI_B = 'pi-t5-b'

beforeAll(async () => {
  // 清空 p-001 既有计划，保证「生效集合」确定性（文件串行执行，不影响其它测试文件）
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.insert(drugMaster).values([
    { id: DM_A, genericName: '玻璃酸钠滴眼液', specification: '0.1%（10mL:10mg）', form: '滴眼剂' },
    { id: DM_B, genericName: '左氧氟沙星滴眼液', specification: '0.5%（5mL:24.4mg）', form: '滴眼剂' },
  ])
  await db.insert(interactionRules).values({
    id: IR,
    drugIds: [DM_A, DM_B],
    level: '需监测',
    note: '两种滴眼液同时使用需间隔至少 30 分钟，先后顺序请咨询医生或药师',
    source: '海露说明书注意事项（演示抄录）',
  })
  await db.insert(packageInserts).values([
    { id: PI_A, drugId: DM_A, genericName: '玻璃酸钠滴眼液', dosage: { adult: { dosePerUse: { value: 1, unit: '滴' }, maxFrequencyPerDay: { value: 10, unit: '次', note: '超出需眼科医生指导' } } }, source: '海露说明书', version: 'v1' },
    { id: PI_B, drugId: DM_B, genericName: '左氧氟沙星滴眼液', dosage: { adult: { dosePerUse: { value: 1, unit: '滴' }, maxFrequencyPerDay: { value: 6, unit: '次', note: '超出需医生指导' } } }, source: '演示说明书', version: 'v1' },
  ])
  await db.insert(drugs).values([
    { id: DRUG_A, userId: USER, genericName: '玻璃酸钠滴眼液', specification: '0.1%', form: '滴眼剂', drugMasterId: DM_A, confirmStatus: 'ocr_matched' },
    { id: DRUG_B, userId: USER, genericName: '左氧氟沙星滴眼液', specification: '0.5%', form: '滴眼剂', drugMasterId: DM_B, confirmStatus: 'ocr_matched' },
  ])
})

afterAll(async () => {
  await db.delete(plans).where(inArray(plans.drugId, [DRUG_A, DRUG_B]))
  await db.delete(drugs).where(inArray(drugs.id, [DRUG_A, DRUG_B]))
  await db.delete(interactionRules).where(eq(interactionRules.id, IR))
  await db.delete(packageInserts).where(inArray(packageInserts.id, [PI_A, PI_B]))
  await db.delete(drugMaster).where(inArray(drugMaster.id, [DM_A, DM_B]))
})

describe('POST /api/plans 规则检查集成（M2-T5）', () => {
  it('为已有生效计划的老药建新计划（续方）→ 触发生效集合相互作用检查', async () => {
    // 老药 A 建生效计划：A 单独在集合 → 无组合，hits 空
    const planA = await req('POST', '/api/plans', { drugId: DRUG_A, dose: { value: 1, unit: '滴' }, frequency: 3, cycleType: 'open' })
    expect(planA.status).toBe(201)
    expect(planA.body.interactions.hits).toEqual([])
    expect(planA.body.dosageRange.status).toBe('pass') // A：3 次/日 ≤ 10

    // 为 B 建计划 → 生效集合 {A,B} → 命中 ir-t5-ab
    const planB = await req('POST', '/api/plans', { drugId: DRUG_B, dose: { value: 1, unit: '滴' }, frequency: 4, cycleType: 'open' })
    expect(planB.status).toBe(201)
    expect(planB.body.plan).toBeTruthy() // 计划照常创建（检查只标注不阻止）
    const hits = planB.body.interactions.hits
    expect(hits).toHaveLength(1)
    expect(hits[0].level).toBe('需监测')
    expect(hits[0].drugNames.slice().sort()).toEqual(['左氧氟沙星滴眼液', '玻璃酸钠滴眼液'].sort())
    expect(planB.body.interactions.coverageNote).toBeNull()
    expect(planB.body.dosageRange.status).toBe('pass') // B：4 次/日 ≤ 6
  })

  it('范围校验超标 → 只标注不阻止：计划仍 201 创建，dosageRange.status=exceed', async () => {
    const res = await req('POST', '/api/plans', { drugId: DRUG_B, dose: { value: 1, unit: '滴' }, frequency: 99, cycleType: 'open' })
    expect(res.status).toBe(201)
    expect(res.body.plan).toBeTruthy()
    expect(res.body.dosageRange.status).toBe('exceed')
    expect(res.body.dosageRange.issues[0]).toMatchObject({ field: 'frequency', planValue: '99 次/日', insertMax: '6 次/日' })
  })

  it('手动建档药（无 drugMasterId）→ 范围校验 none（无说明书），计划照常创建', async () => {
    const manual = await req('POST', '/api/drugs', { genericName: 'T5 手动的药', specification: '5mg', form: '片剂' })
    expect(manual.status).toBe(201)
    const drugId = manual.body.drug.id as string
    expect(manual.body.drug.drugMasterId).toBeNull()

    const res = await req('POST', '/api/plans', { drugId, dose: { value: 1, unit: '片' }, frequency: 2, cycleType: 'open' })
    expect(res.status).toBe(201)
    expect(res.body.dosageRange.status).toBe('none') // 手动药无 drugMasterId → 无说明书

    await req('DELETE', `/api/drugs/${drugId}`) // 清理（级联删其计划）
  })
})
