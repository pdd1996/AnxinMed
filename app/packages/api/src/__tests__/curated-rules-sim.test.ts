/**
 * M11-T1 · 已入库 curated 规则的「模拟患者」集成验证。
 *
 * 造一个独立用户（p-sim-curated，不动 p-001 演示数据），按 5 条真规则建在服计划，
 * 走真实 consult 服务链路（DB 规则 → activeMasterIds → runDataQuery interaction-check），
 * 断言：5 条命中、级别/药名/来源正确；局部制剂（布洛芬乳膏）不误命中。
 *
 * 只测服务层 + DB，不打模型（interaction-check 是 0 次 LLM 数据直答）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { consultLogs, drugMaster, drugs, interactionRules, plans, users } from '../db/schema.js'
import { consult } from '../services/consult.service.js'

const USER = 'p-sim-curated'
const RULE_IDS = ['m10-cand-02', 'm10-cand-04', 'm10-cand-07', 'm10-cand-14', 'm10-cand-20']

/** 每个场景两个产品（真实 drug_master ID，取自 seed-additions 的 groups）。 */
const SCENARIOS: Array<{ ruleId: string; left: string; right: string; level: string }> = [
  { ruleId: 'm10-cand-02', left: 'drug-kelameisu-huanshi-pian-0p5g', right: 'drug-qiushuixianjian-pian-1mg', level: '禁忌' },
  { ruleId: 'm10-cand-04', left: 'drug-yansuan-paluoxiting-pian-20mg-h20133084', right: 'drug-linaizuoan-putaotang-zhusheye-300ml', level: '禁忌' },
  { ruleId: 'm10-cand-07', left: 'drug-amlodipine-5', right: 'drug-takemosi-jiaonang-1mg', level: '慎用' },
  { ruleId: 'm10-cand-14', left: 'drug-buluofen-pian-0p1', right: 'drug-zhusheyong-jia-an-dieling-0p1g', level: '慎用' },
  { ruleId: 'm10-cand-20', left: 'drug-yansuan-fuxiting-jiaonang-20mg', right: 'drug-huafalinna-pian-2p5mg', level: '需监测' },
]

interface SeedRule {
  id: string
  drugIds: string[]
  drugGroups: string[][]
  level: string
  note: string
  source: string
  status: string
}

function seedRules(): SeedRule[] {
  const path = fileURLToPath(new URL('../db/seed-interaction-rules.json', import.meta.url))
  const all = JSON.parse(readFileSync(path, 'utf8')) as SeedRule[]
  return all.filter((r) => RULE_IDS.includes(r.id))
}

async function createPlan(drugId: string, planId: string, masterId: string, name: string, form: string): Promise<void> {
  await db.insert(drugMaster).values({ id: masterId, genericName: name, specification: '—', form, curationStatus: 'mock' }).onConflictDoNothing()
  await db
    .insert(drugs)
    .values({ id: drugId, userId: USER, genericName: name, form, drugMasterId: masterId, confirmStatus: 'transcribed' })
    .onConflictDoNothing()
  await db.insert(plans).values({
    id: planId,
    userId: USER,
    drugId,
    dose: { value: 1, unit: '片' },
    frequency: 1,
    times: ['08:00'],
    cycleType: 'open',
    startDate: '2026-01-01',
    status: 'active',
    source: 'manual',
  })
}

beforeAll(async () => {
  await cleanup()
  await db.insert(users).values({ id: USER, name: '模拟患者（规则验证）' }).onConflictDoNothing()
  const rules = seedRules()
  expect(rules).toHaveLength(RULE_IDS.length)
  await db.insert(interactionRules).values(
    rules.map((r) => ({
      id: r.id,
      drugIds: r.drugIds,
      drugGroups: r.drugGroups,
      level: r.level as '禁忌' | '慎用' | '需监测' | '注意',
      note: r.note,
      source: r.source,
      status: 'curated' as const,
    })),
  )

  const names: Record<string, string> = {
    'drug-kelameisu-huanshi-pian-0p5g': '克拉霉素缓释片',
    'drug-qiushuixianjian-pian-1mg': '秋水仙碱片',
    'drug-yansuan-paluoxiting-pian-20mg-h20133084': '盐酸帕罗西汀片',
    'drug-linaizuoan-putaotang-zhusheye-300ml': '利奈唑胺葡萄糖注射液',
    'drug-amlodipine-5': '苯磺酸氨氯地平片',
    'drug-takemosi-jiaonang-1mg': '他克莫司胶囊',
    'drug-buluofen-pian-0p1': '布洛芬片',
    'drug-zhusheyong-jia-an-dieling-0p1g': '注射用甲氨蝶呤',
    'drug-yansuan-fuxiting-jiaonang-20mg': '盐酸氟西汀胶囊',
    'drug-huafalinna-pian-2p5mg': '华法林钠片',
  }
  const forms: Record<string, string> = {
    'drug-kelameisu-huanshi-pian-0p5g': '缓释片',
    'drug-qiushuixianjian-pian-1mg': '片',
    'drug-yansuan-paluoxiting-pian-20mg-h20133084': '片',
    'drug-linaizuoan-putaotang-zhusheye-300ml': '注射液',
    'drug-amlodipine-5': '片',
    'drug-takemosi-jiaonang-1mg': '胶囊',
    'drug-buluofen-pian-0p1': '片',
    'drug-zhusheyong-jia-an-dieling-0p1g': '注射用',
    'drug-yansuan-fuxiting-jiaonang-20mg': '胶囊',
    'drug-huafalinna-pian-2p5mg': '片',
  }
  let i = 0
  for (const s of SCENARIOS) {
    for (const masterId of [s.left, s.right]) {
      i += 1
      await createPlan(`sim-drug-${i}`, `sim-plan-${i}`, masterId, names[masterId], forms[masterId])
    }
  }
})

afterAll(async () => {
  await cleanup()
})

async function cleanup(): Promise<void> {
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))
  await db.delete(users).where(eq(users.id, USER))
  await db.delete(interactionRules).where(inArray(interactionRules.id, RULE_IDS))
}

describe('M11 · curated 规则模拟患者（真实 consult 链路）', () => {
  it('5 条已入库规则全部命中：级别/药名/来源/0 次 LLM', async () => {
    const res = await consult(USER, '这些药一起吃有冲突吗', [])
    expect(res.status).toBe('data-answered')
    expect(res.toolUsed).toBe('interaction-check')
    const sections = res.sections
    if (!sections) throw new Error('sections 缺失')
    expect(sections.summary).toContain('5 项相互作用提示')

    const points = sections.keyPoints.join('\n')
    for (const level of ['[禁忌]', '[慎用]', '[需监测]']) expect(points).toContain(level)
    expect(points).toContain('克拉霉素缓释片 + 秋水仙碱片')
    expect(points).toContain('盐酸帕罗西汀片 + 利奈唑胺葡萄糖注射液')
    expect(points).toContain('苯磺酸氨氯地平片 + 他克莫司胶囊')
    expect(points).toContain('布洛芬片 + 注射用甲氨蝶呤')
    expect(points).toContain('盐酸氟西汀胶囊 + 华法林钠片')
    expect(points).toContain('来源：')
  })

  it('局部制剂不误命中：布洛芬乳膏 + 地高辛 → 未检出（#14 只覆盖口服布洛芬）', async () => {
    await db.delete(plans).where(eq(plans.userId, USER))
    await db.delete(drugs).where(eq(drugs.userId, USER))
    await createPlan('sim-drug-cream', 'sim-plan-cream', 'drug-buluofen-rugao-20', '布洛芬乳膏', '乳膏')
    await createPlan('sim-drug-digoxin', 'sim-plan-digoxin', 'drug-digaoxin-pian-0p25mg', '地高辛片', '片')

    const res = await consult(USER, '这些药一起吃有冲突吗', [])
    expect(res.status).toBe('data-answered')
    expect(res.toolUsed).toBe('interaction-check')
    const sections = res.sections
    if (!sections) throw new Error('sections 缺失')
    expect(sections.summary).toContain('未检出已知相互作用')
    expect(sections.keyPoints.join('\n')).toContain('未被相互作用规则库覆盖')
  })
})
