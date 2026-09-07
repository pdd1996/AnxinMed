/**
 * AI 药师意图路由 · 数据查询工具与模板单测（计划 T3）。
 *
 * 两部分：
 * A. 纯函数（fake 数据，不连库）：dbCitation + 4 个 render*Sections
 *    —— 断言各意图 sections 结构、citation 三件套、空数据友好文案、剂量表述红线。
 * B. runDataQuery 集成（真实测试库，参照 consult-api.test.ts 的 beforeAll 建数据方式）：
 *    —— 4 意图命中数据 + 空数据，断言 status='data-answered' / riskLevel='L1' / blocked=false /
 *       toolUsed / citations 含 DB 来源。用独立 userId（p-dq-001）避免与 consult-api 的 p-001 冲突。
 *
 * = 26 case（纯函数 17 + 集成 9）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { todayStr, addDaysStr } from '@anxin/shared'
import { db } from '../db/client.js'
import { drugs, plans, records } from '../db/schema.js'
import { dbCitation } from '../services/consult/citations.js'
import {
  runDataQuery,
  renderMedicationListSections,
  renderAdherenceSections,
  renderExpiryStockSections,
  renderInteractionsSections,
} from '../services/consult/dataquery.js'
import type { MedicationItem, AdherenceStats, ExpiryStatus } from '../repositories/insight.repo.js'
import type { InteractionResult, InteractionRuleInput } from '../services/rules/index.js'

// ---------------------------------------------------------------------------
// 测试夹具（fake 数据构造器）
// ---------------------------------------------------------------------------

const mkMed = (o: Partial<MedicationItem> = {}): MedicationItem => ({
  id: 'd1',
  genericName: '测试药',
  brandName: null,
  specification: null,
  form: null,
  stock: null,
  expiry: null,
  ...o,
})

const mkStats = (o: Partial<AdherenceStats> = {}): AdherenceStats => ({
  rate: 0,
  taken: 0,
  skipped: 0,
  total: 0,
  consecutiveSkip: 0,
  skipDetails: [],
  dateRange: 30,
  ...o,
})

// ===========================================================================
// A. 纯函数（fake 数据，不连库）
// ===========================================================================

describe('dbCitation · 数据查询引用三件套', () => {
  it('三件套齐备 + unverified=false + version 为 ISO 时间戳', () => {
    const c = dbCitation(new Date('2026-09-07T12:00:00Z'))
    expect(c).toEqual({
      drugName: '我的用药数据',
      source: '本地数据库（drugs/plans/records，仅本人可见）',
      version: '2026-09-07T12:00:00.000Z',
      unverified: false,
    })
  })

  it('缺省参数 → 用当前时刻（version 为合法 ISO 串）', () => {
    const c = dbCitation()
    expect(() => new Date(c.version)).not.toThrow()
    expect(c.version).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(c.unverified).toBe(false)
  })
})

describe('renderMedicationListSections · 药箱清单模板（纯函数）', () => {
  it('空药箱 → 友好固定文案 + 安全语', () => {
    const s = renderMedicationListSections([])
    expect(s.summary).toContain('没有建档药品')
    expect(s.keyPoints.length).toBeGreaterThan(0)
    expect(s.warning).toContain('遵医嘱')
    expect(s.limited).toBe(false)
  })

  it('非空 → 编号清单 + 通用名（商品名 · 规格 · 剂型）', () => {
    const s = renderMedicationListSections([
      mkMed({ genericName: '玻璃酸钠滴眼液', brandName: '海露', specification: '0.1%', form: '滴眼液' }),
      mkMed({ id: 'd2', genericName: '阿莫西林胶囊' }),
    ])
    expect(s.summary).toContain('2 种')
    expect(s.keyPoints[0]).toContain('1.')
    expect(s.keyPoints[0]).toContain('玻璃酸钠滴眼液（海露 · 0.1% · 滴眼液）')
    expect(s.keyPoints[1]).toContain('阿莫西林胶囊')
    expect(s.nextAction).toContain('药箱')
  })

  it('超过 10 种 → 截断 + 汇总行（不无限拉长）', () => {
    const meds = Array.from({ length: 12 }, (_, i) => mkMed({ id: `d${i}`, genericName: `药${i}` }))
    const s = renderMedicationListSections(meds)
    expect(s.keyPoints).toHaveLength(11) // 10 条明细 + 1 汇总
    expect(s.keyPoints[10]).toContain('及其他 2 种')
  })

  it('红线：清单模板不出现「每次X片」类剂量表述', () => {
    const s = renderMedicationListSections([mkMed({ stock: { value: 3, unit: '片' } })])
    const all = [s.summary, ...s.keyPoints, ...s.risks, s.nextAction, s.warning].join('')
    expect(all).not.toMatch(/每次\s*\d+\s*片/)
    expect(all).not.toMatch(/一日\s*\d+\s*次/)
  })
})

describe('renderAdherenceSections · 依从性模板（纯函数）', () => {
  it('无记录 → 友好固定文案', () => {
    const s = renderAdherenceSections(mkStats())
    expect(s.summary).toContain('还没有服药打卡记录')
    expect(s.nextAction).toContain('今日')
  })

  it('正常统计 → 执行率 + 漏服 + 连续漏服 + 低执行率风险提示', () => {
    const s = renderAdherenceSections(
      mkStats({
        rate: 40,
        taken: 2,
        skipped: 3,
        total: 5,
        consecutiveSkip: 3,
        skipDetails: [
          { date: '2026-09-07', drugId: 'p1' },
          { date: '2026-09-06', drugId: 'p1' },
        ],
      }),
    )
    expect(s.summary).toContain('40%')
    expect(s.keyPoints.join('')).toContain('漏服 3 次')
    expect(s.keyPoints.join('')).toContain('连续漏服 3 次')
    expect(s.keyPoints.join('')).toContain('最近漏服日期')
    expect(s.risks.join('')).toContain('连续漏服')
    expect(s.risks.join('')).toContain('执行率')
  })

  it('高执行率 + 无连续漏服 → 无风险提示（risks 空）', () => {
    const s = renderAdherenceSections(mkStats({ rate: 95, taken: 19, skipped: 1, total: 20, consecutiveSkip: 0 }))
    expect(s.risks).toHaveLength(0)
  })

  it('红线：执行率统计数字不被误判为剂量（模板不经 normalizeSections）', () => {
    const s = renderAdherenceSections(mkStats({ rate: 85, taken: 17, skipped: 3, total: 20 }))
    expect(s.summary).toContain('85%') // 统计数字保留，未被 L2 剂量正则切除
    expect(s.limited).toBe(false)
  })
})

describe('renderExpiryStockSections · 效期库存模板（纯函数）', () => {
  it('全空 → 友好固定文案', () => {
    const s = renderExpiryStockSections({ expiring: [], expired: [], lowStock: [] })
    expect(s.summary).toContain('暂无过期')
    expect(s.nextAction.length).toBeGreaterThan(0)
  })

  it('过期 + 临期 + 低库存 → 分类文案 + 风险提示', () => {
    const s = renderExpiryStockSections({
      expired: [{ ...mkMed({ genericName: '过期药' }), days: -5 }],
      expiring: [{ ...mkMed({ genericName: '临期药' }), days: 10 }],
      lowStock: [mkMed({ genericName: '低库存药', stock: { value: 5, unit: '片' } })],
    })
    expect(s.summary).toContain('1 种已过期')
    expect(s.summary).toContain('1 种 30 天内到期')
    expect(s.summary).toContain('1 种库存不足')
    expect(s.keyPoints.join('')).toContain('过期药 已过期 5 天')
    expect(s.keyPoints.join('')).toContain('临期药 约 10 天后到期')
    expect(s.keyPoints.join('')).toContain('低库存药 库存不足')
    expect(s.risks.join('')).toContain('过期药品请勿继续服用')
  })

  it('今天到期（days=0）→「今天到期」而非「约 0 天后」', () => {
    const s = renderExpiryStockSections({
      expiring: [{ ...mkMed({ genericName: '今天药' }), days: 0 }],
      expired: [],
      lowStock: [],
    })
    expect(s.keyPoints.join('')).toContain('今天药 今天到期')
  })
})

describe('renderInteractionsSections · 相互作用模板（纯函数）', () => {
  it('无生效计划 → 友好固定文案', () => {
    const s = renderInteractionsSections({ hits: [], coverageNote: null }, [])
    expect(s.summary).toContain('没有生效中的用药计划')
  })

  it('单药 → 不构成联用组合', () => {
    const s = renderInteractionsSections({ hits: [], coverageNote: null }, ['dm-a'])
    expect(s.summary).toContain('只有 1 种药品')
  })

  it('≥2 药命中规则 → 分级 + 药名 + 来源展示', () => {
    const result: InteractionResult = {
      hits: [
        {
          level: '禁忌',
          note: '出血风险升高',
          source: '测试规则库',
          drugIds: ['dm-a', 'dm-b'],
          drugNames: ['华法林钠片', '阿司匹林肠溶片'],
        },
      ],
      coverageNote: null,
    }
    const s = renderInteractionsSections(result, ['dm-a', 'dm-b'])
    expect(s.summary).toContain('1 项相互作用提示')
    expect(s.keyPoints[0]).toContain('禁忌')
    expect(s.keyPoints[0]).toContain('华法林钠片 + 阿司匹林肠溶片')
    expect(s.keyPoints[0]).toContain('测试规则库')
    expect(s.risks.join('')).toContain('请勿自行停药')
  })

  it('≥2 药无命中 → coverageNote（未覆盖 ≠ 无风险）', () => {
    const s = renderInteractionsSections(
      { hits: [], coverageNote: '当前药品组合未被相互作用规则库覆盖 ≠ 无风险，联用前请咨询医生或药师' },
      ['dm-a', 'dm-b'],
    )
    expect(s.summary).toContain('未检出已知相互作用')
    expect(s.keyPoints.join('')).toContain('未被相互作用规则库覆盖')
  })
})

// ===========================================================================
// B. runDataQuery 集成（真实测试库；独立 userId 避免与 consult-api 的 p-001 冲突）
// ===========================================================================

const USER = 'p-dq-001'
const EMPTY_USER = 'p-dq-empty'
const DRUG_1 = 'drug-dq-hycosan'
const DRUG_2 = 'drug-dq-expired'
const DRUG_3 = 'drug-dq-lowstock'
const PLAN_1 = 'plan-dq-1'

beforeAll(async () => {
  // 清理可能的残留，保证 fixture 确定性
  await db.delete(records).where(eq(records.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))
  await db.delete(records).where(eq(records.userId, EMPTY_USER))
  await db.delete(drugs).where(eq(drugs.userId, EMPTY_USER))

  const today = todayStr()
  // 3 支药：正常 / 过期（today-5）/ 临期（today+10）+ 低库存（5 片）
  await db.insert(drugs).values([
    {
      id: DRUG_1,
      userId: USER,
      genericName: '玻璃酸钠滴眼液',
      brandName: '海露',
      specification: '0.1%',
      form: '滴眼液',
      drugMasterId: null,
      confirmStatus: 'ocr_matched',
      stock: { value: 20, unit: '支' },
      expiry: addDaysStr(today, 100),
    },
    {
      id: DRUG_2,
      userId: USER,
      genericName: '阿莫西林胶囊',
      form: '胶囊',
      drugMasterId: null,
      confirmStatus: 'manual',
      stock: null,
      expiry: addDaysStr(today, -5),
    },
    {
      id: DRUG_3,
      userId: USER,
      genericName: '布洛芬片',
      specification: '0.3g',
      form: '片剂',
      drugMasterId: null,
      confirmStatus: 'ocr_matched',
      stock: { value: 5, unit: '片' },
      expiry: addDaysStr(today, 10),
    },
  ])
  // 计划 + 5 条记录（2 taken + 3 skipped，最近连续 3 次 skipped → consecutiveSkip=3, rate=40%）
  await db.insert(plans).values({
    id: PLAN_1,
    userId: USER,
    drugId: DRUG_1,
    dose: { value: 1, unit: '滴' },
    frequency: 1,
    times: ['08:00'],
    cycleType: 'open',
    startDate: addDaysStr(today, -7),
    status: 'active',
    source: 'manual',
  })
  await db.insert(records).values([
    { id: 'rec-dq-1', userId: USER, planId: PLAN_1, scheduledDate: addDaysStr(today, -4), scheduledTime: '08:00', status: 'taken', actedAt: new Date() },
    { id: 'rec-dq-2', userId: USER, planId: PLAN_1, scheduledDate: addDaysStr(today, -3), scheduledTime: '08:00', status: 'taken', actedAt: new Date() },
    { id: 'rec-dq-3', userId: USER, planId: PLAN_1, scheduledDate: addDaysStr(today, -2), scheduledTime: '08:00', status: 'skipped', actedAt: new Date() },
    { id: 'rec-dq-4', userId: USER, planId: PLAN_1, scheduledDate: addDaysStr(today, -1), scheduledTime: '08:00', status: 'skipped', actedAt: new Date() },
    { id: 'rec-dq-5', userId: USER, planId: PLAN_1, scheduledDate: today, scheduledTime: '08:00', status: 'skipped', actedAt: new Date() },
  ])
})

afterAll(async () => {
  await db.delete(records).where(eq(records.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))
})

/** 组装 DataQueryInput（interaction-check 才需后三者；其余意图传空即可）。 */
const mkInput = (intent: Parameters<typeof runDataQuery>[0]['intent'], over: Partial<Parameters<typeof runDataQuery>[0]> = {}) => ({
  userId: USER,
  intent,
  activeMasterIds: [],
  interactionRules: [] as InteractionRuleInput[],
  drugNameById: {},
  ...over,
})

describe('runDataQuery · medication-list 集成', () => {
  it('命中 3 支药 → data-answered + L1 + toolUsed + DB citation + 清单含药名', async () => {
    const r = await runDataQuery(mkInput('medication-list'))
    expect(r.status).toBe('data-answered')
    expect(r.riskLevel).toBe('L1')
    expect(r.blocked).toBe(false)
    expect(r.toolUsed).toBe('medication-list')
    expect(r.citations).toHaveLength(1)
    expect(r.citations[0]).toMatchObject({ drugName: '我的用药数据', unverified: false })
    expect(r.citations[0].source).toContain('本地数据库')
    expect(r.sections!.summary).toContain('3 种')
    expect(r.sections!.keyPoints.join('')).toContain('玻璃酸钠滴眼液')
    expect(r.answer).toContain('3 种') // answer = summary + 要点拼接
  })
})

describe('runDataQuery · adherence 集成', () => {
  it('命中记录 → 执行率 40% + 连续漏服 3 次提示', async () => {
    const r = await runDataQuery(mkInput('adherence'))
    expect(r.status).toBe('data-answered')
    expect(r.toolUsed).toBe('adherence')
    expect(r.sections!.summary).toContain('40%')
    expect(r.sections!.keyPoints.join('')).toContain('漏服 3 次')
    expect(r.sections!.risks.join('')).toContain('连续漏服')
    expect(r.citations[0].unverified).toBe(false)
  })
})

describe('runDataQuery · expiry-stock 集成', () => {
  it('命中过期/临期/低库存 → 分类文案', async () => {
    const r = await runDataQuery(mkInput('expiry-stock'))
    expect(r.status).toBe('data-answered')
    expect(r.toolUsed).toBe('expiry-stock')
    expect(r.sections!.summary).toContain('已过期')
    expect(r.sections!.keyPoints.join('')).toContain('阿莫西林胶囊')
    expect(r.sections!.keyPoints.join('')).toContain('布洛芬片')
    expect(r.sections!.risks.join('')).toContain('过期药品请勿继续服用')
  })
})

describe('runDataQuery · interaction-check 集成（纯传参，不查库）', () => {
  it('命中规则（禁忌级）→ 分级展示', async () => {
    const r = await runDataQuery(
      mkInput('interaction-check', {
        activeMasterIds: ['dm-a', 'dm-b'],
        interactionRules: [
          { id: 'r1', drugIds: ['dm-a', 'dm-b'], level: '禁忌', note: '华法林与阿司匹林联用出血风险升高（测试抄录）', source: '测试规则库' },
        ],
        drugNameById: { 'dm-a': '华法林钠片', 'dm-b': '阿司匹林肠溶片' },
      }),
    )
    expect(r.status).toBe('data-answered')
    expect(r.toolUsed).toBe('interaction-check')
    expect(r.sections!.summary).toContain('1 项相互作用提示')
    expect(r.sections!.keyPoints[0]).toContain('禁忌')
    expect(r.sections!.keyPoints[0]).toContain('华法林钠片')
  })

  it('≥2 药无命中规则 → coverageNote（未覆盖 ≠ 无风险）', async () => {
    const r = await runDataQuery(mkInput('interaction-check', { activeMasterIds: ['dm-a', 'dm-b'] }))
    expect(r.sections!.summary).toContain('未检出已知相互作用')
    expect(r.sections!.keyPoints.join('')).toContain('未被相互作用规则库覆盖')
  })

  it('无生效计划 → 友好文案', async () => {
    const r = await runDataQuery(mkInput('interaction-check', { activeMasterIds: [] }))
    expect(r.sections!.summary).toContain('没有生效中的用药计划')
  })
})

describe('runDataQuery · 空数据友好文案（独立无数据 userId）', () => {
  it('空药箱 → medication-list 友好文案', async () => {
    const r = await runDataQuery(mkInput('medication-list', { userId: EMPTY_USER }))
    expect(r.status).toBe('data-answered')
    expect(r.sections!.summary).toContain('没有建档药品')
  })

  it('无记录 → adherence 友好文案', async () => {
    const r = await runDataQuery(mkInput('adherence', { userId: EMPTY_USER }))
    expect(r.sections!.summary).toContain('还没有服药打卡记录')
  })

  it('空药箱 → expiry-stock 友好文案', async () => {
    const r = await runDataQuery(mkInput('expiry-stock', { userId: EMPTY_USER }))
    expect(r.sections!.summary).toContain('暂无过期')
  })
})
