/**
 * V2.5 · 主动干预（PRD §7.8.2）：入箱预检 / 常驻安全汇总 / 计划变更重跑 的 API 集成测试。
 *
 * 断言口径：
 * - 检查对象始终是「生效计划集合」，不是药箱库存；
 * - 入箱预检：入口B 仅建档（无计划）与手动建档两条路径都要有明确结果（checked 或 unavailable，不得静默）；
 * - 计划恢复（paused→active）后重跑并把命中随响应返回；
 * - 常驻汇总如实披露规则库规模/演示状态与「在服但未关联标准库」的药（skippedDrugNames）。
 *
 * 测试库 globalSetup 只 seed users，本文件自建资产域 fixture 并在 afterAll 清理。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { drugMaster, interactionRules, drugs, plans, drafts } from '../db/schema.js'
import type { DraftPayload } from '../services/pipeline/types.js'

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
const DM_A = 'dm-v25-a'
const DM_B = 'dm-v25-b'
const DRUG_A = 'drug-v25-a'
const DRUG_B = 'drug-v25-b'
const IR = 'ir-v25-ab'
const DRAFT_ID = 'draft-v25-b'
const DRAFT_ID_EMPTY = 'draft-v25-empty'

let planBId = ''

beforeAll(async () => {
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.insert(drugMaster).values([
    {
      id: DM_A,
      genericName: '玻璃酸钠滴眼液',
      specification: '0.1%（10mL:10mg）',
      form: '滴眼剂',
    },
    {
      id: DM_B,
      genericName: '左氧氟沙星滴眼液',
      specification: '0.5%（5mL:24.4mg）',
      form: '滴眼剂',
    },
  ])
  await db.insert(interactionRules).values({
    id: IR,
    drugIds: [DM_A, DM_B],
    level: '需监测',
    note: '两种滴眼液同时使用需间隔至少 30 分钟，先后顺序请咨询医生或药师',
    source: '演示抄录 · 两药说明书相互作用段',
    // status 缺省='demo'：同时覆盖「演示条目必须在 UI/统计里可辨识」
  })
  await db.insert(drugs).values([
    {
      id: DRUG_A,
      userId: USER,
      genericName: '玻璃酸钠滴眼液',
      specification: '0.1%',
      form: '滴眼剂',
      drugMasterId: DM_A,
      confirmStatus: 'ocr_matched',
    },
    {
      id: DRUG_B,
      userId: USER,
      genericName: '左氧氟沙星滴眼液',
      specification: '0.5%',
      form: '滴眼剂',
      drugMasterId: DM_B,
      confirmStatus: 'ocr_matched',
    },
  ])
})

beforeEach(async () => {
  // 每条用例从「A、B 两支在服」这一确定状态开始
  await db.delete(plans).where(eq(plans.userId, USER))
  const a = await req('POST', '/api/plans', {
    drugId: DRUG_A,
    dose: { value: 1, unit: '滴' },
    frequency: 3,
    cycleType: 'open',
  })
  const b = await req('POST', '/api/plans', {
    drugId: DRUG_B,
    dose: { value: 1, unit: '滴' },
    frequency: 3,
    cycleType: 'open',
  })
  expect(a.status).toBe(201)
  expect(b.status).toBe(201)
  planBId = b.body.plan.id
})

afterAll(async () => {
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drafts).where(inArray(drafts.id, [DRAFT_ID, DRAFT_ID_EMPTY]))
  await db.delete(drugs).where(inArray(drugs.id, [DRUG_A, DRUG_B]))
  await db.delete(interactionRules).where(eq(interactionRules.id, IR))
  await db.delete(drugMaster).where(inArray(drugMaster.id, [DM_A, DM_B]))
})

describe('GET /api/safety · 常驻安全汇总', () => {
  it('没有生效计划 → 空汇总，不误报', async () => {
    await db.delete(plans).where(eq(plans.userId, USER))
    const res = await req('GET', '/api/safety')
    expect(res.status).toBe(200)
    expect(res.body.activePlanCount).toBe(0)
    expect(res.body.interactions.hits).toEqual([])
    expect(res.body.interactions.coverageNote).toBeNull()
  })

  it('A+B 在服 → 命中规则，并如实返回规则库统计与参与比对的药名', async () => {
    const res = await req('GET', '/api/safety')
    expect(res.status).toBe(200)
    expect(res.body.activePlanCount).toBe(2)
    expect(res.body.interactions.hits).toHaveLength(1)
    expect(res.body.interactions.hits[0].level).toBe('需监测')
    expect(res.body.interactions.hits[0].status).toBe('demo')
    expect(res.body.checkedDrugNames.slice().sort()).toEqual(
      ['左氧氟沙星滴眼液', '玻璃酸钠滴眼液'].sort(),
    )
    expect(res.body.skippedDrugNames).toEqual([])
    expect(res.body.ruleLibrary).toEqual({ total: 1, demo: 1, curated: 0 })
    expect(typeof res.body.checkedAt).toBe('string')
  })
})

describe('PATCH /api/plans · 变更后重跑（时机二补齐）', () => {
  it('暂停 B → 生效集合只剩 A，无组合可检；恢复 B → 重新命中并随响应返回', async () => {
    const pause = await req('PATCH', `/api/plans/${planBId}`, { status: 'paused' })
    expect(pause.status).toBe(200)
    expect(pause.body.plan.status).toBe('paused')
    expect(pause.body.interactions.hits).toEqual([])

    const resume = await req('PATCH', `/api/plans/${planBId}`, { status: 'active' })
    expect(resume.status).toBe(200)
    expect(resume.body.plan.status).toBe('active')
    expect(resume.body.interactions.hits).toHaveLength(1)
  })

  it('暂停 B 后安全汇总同步更新（activePlanCount/命中都不含 B）', async () => {
    await req('PATCH', `/api/plans/${planBId}`, { status: 'paused' })
    const res = await req('GET', '/api/safety')
    expect(res.body.activePlanCount).toBe(1)
    expect(res.body.interactions.hits).toEqual([])
    expect(res.body.checkedDrugNames).toEqual(['玻璃酸钠滴眼液'])
  })
})

describe('入箱预检 · 手动建档（POST /api/drugs）', () => {
  it('有在服计划 → unavailable/manual 明示无法比对，不假装查过；入箱后汇总把它列为 skipped', async () => {
    const created = await req('POST', '/api/drugs', {
      genericName: '测试手动药',
      specification: '1mg',
      form: '片剂',
    })
    expect(created.status).toBe(201)
    expect(created.body.drug.drugMasterId).toBeNull()
    expect(created.body.precheck.status).toBe('unavailable')
    expect(created.body.precheck.reason).toBe('manual')
    expect(created.body.precheck.activePlanCount).toBe(2)
    expect(created.body.precheck.message).toContain('无法自动核对')

    const drugId = created.body.drug.id as string
    // 为手动药建生效计划 → 汇总必须诚实披露它未参与比对（不是静默当作已查）
    await req('POST', '/api/plans', {
      drugId,
      dose: { value: 1, unit: '片' },
      frequency: 1,
      cycleType: 'open',
    })
    const safety = await req('GET', '/api/safety')
    expect(safety.body.activePlanCount).toBe(3)
    expect(safety.body.skippedDrugNames).toEqual(['测试手动药'])
    expect(safety.body.interactions.hits).toHaveLength(1)

    await req('DELETE', `/api/drugs/${drugId}`)
  })

  it('没有生效计划时仍返回 unavailable（manual），不阻断建档', async () => {
    await db.delete(plans).where(eq(plans.userId, USER))
    const created = await req('POST', '/api/drugs', {
      genericName: '空药箱手动药',
      specification: '1mg',
      form: '片剂',
    })
    expect(created.status).toBe(201)
    expect(created.body.precheck.status).toBe('unavailable')
    expect(created.body.precheck.reason).toBe('manual')
    expect(created.body.precheck.activePlanCount).toBe(0)
    await req('DELETE', `/api/drugs/${created.body.drug.id}`)
  })
})

/** 入口B（药盒）草稿载荷：结构上无 planDraft（V2.1 红线）。 */
function drugBoxPayload(): DraftPayload {
  return {
    entry: 'B',
    type: 'drug',
    layers: ['药盒原装层'],
    needsManual: [],
    drugDraft: {
      genericName: '左氧氟沙星滴眼液',
      specification: '0.5%（5mL:24.4mg）',
      form: '滴眼剂',
      drugMasterId: DM_B,
      confirmStatus: 'ocr_matched',
    },
    conflicts: [],
    healthSuggestions: [],
    interactions: { hits: [], coverageNote: null },
    dosageRange: {
      status: 'none',
      issues: [],
      note: '说明书库未收录该药品的结构化用法用量，跳过范围校验',
    },
    degraded: null,
  }
}

/** 入口B 确认入参：只建档、不带计划。 */
function drugBoxConfirmBody() {
  return {
    drug: {
      genericName: '左氧氟沙星滴眼液',
      specification: '0.5%（5mL:24.4mg）',
      form: '滴眼剂',
      drugMasterId: DM_B,
      confirmStatus: 'ocr_matched' as const,
    },
    plan: null,
  }
}

describe('入箱预检 · 入口B 仅建档（POST /api/drafts/:id/confirm）', () => {
  it('无计划确认 → precheck 对本药 × 生效集合检查，命中随响应返回', async () => {
    // 只留 A 在服；新加入 B → {A,B} 命中
    await req('DELETE', `/api/plans/${planBId}`)
    await db.insert(drafts).values({ id: DRAFT_ID, userId: USER, type: 'drug', payload: drugBoxPayload() })

    const res = await req('POST', `/api/drafts/${DRAFT_ID}/confirm`, drugBoxConfirmBody())
    expect(res.status).toBe(200)
    expect(res.body.planId).toBeNull()
    expect(res.body.interactions).toBeNull() // 无计划路径的相互作用走 precheck，不混用旧字段
    expect(res.body.precheck.status).toBe('checked')
    expect(res.body.precheck.interactions.hits).toHaveLength(1)
    expect(res.body.precheck.activePlanCount).toBe(1)

    await req('DELETE', `/api/drugs/${res.body.drugId as string}`)
  })

  it('没有生效计划 → unavailable/no-active-plans，确认仍然成功（只提示不阻止）', async () => {
    await db.delete(plans).where(eq(plans.userId, USER))
    await db
      .insert(drafts)
      .values({ id: DRAFT_ID_EMPTY, userId: USER, type: 'drug', payload: drugBoxPayload() })

    const res = await req('POST', `/api/drafts/${DRAFT_ID_EMPTY}/confirm`, drugBoxConfirmBody())
    expect(res.status).toBe(200)
    expect(res.body.planId).toBeNull()
    expect(res.body.precheck.status).toBe('unavailable')
    expect(res.body.precheck.reason).toBe('no-active-plans')
    expect(res.body.precheck.activePlanCount).toBe(0)

    await req('DELETE', `/api/drugs/${res.body.drugId as string}`)
  })
})
