/** M9-T1 · demo 药箱重复行清理规划器单测。 */
import { describe, it, expect } from 'vitest'
import { planDemoDrugCleanup, type DemoDrugRefs, type DemoDrugRow } from '../services/review/demo-drug-cleanup.js'

function row(id: string, confirmStatus: string, createdAt = '2026-10-15T00:00:00.000Z'): DemoDrugRow {
  return {
    id,
    userId: 'p-001',
    drugMasterId: 'drug-hycosan-01',
    genericName: '玻璃酸钠滴眼液',
    brandName: '海露',
    confirmStatus,
    createdAt,
  }
}

const NONE: DemoDrugRefs = { planRefs: 0, riskEventRefs: 0, draftRefs: 0 }
const PLAN: DemoDrugRefs = { planRefs: 1, riskEventRefs: 0, draftRefs: 0 }

describe('planDemoDrugCleanup · p-001 海露重复行', () => {
  it('1 行被引用 + 3 行无引用 → 删 3 留 1', () => {
    const plan = planDemoDrugCleanup(
      [row('a', 'ocr_matched'), row('b', 'ocr_matched'), row('c', 'ocr_matched'), row('d', 'transcribed', '2026-10-21T00:00:00.000Z')],
      { a: NONE, b: NONE, c: NONE, d: PLAN },
    )
    expect(plan.errors).toEqual([])
    expect(plan.deletes.sort()).toEqual(['a', 'b', 'c'])
    expect(plan.keeps).toEqual(['d'])
    expect(plan.keepReasons.d).toContain('有引用')
  })

  it('全部被引用 → 一行不删（幂等 no-op）', () => {
    const plan = planDemoDrugCleanup([row('a', 'ocr_matched'), row('b', 'manual')], { a: PLAN, b: { planRefs: 0, riskEventRefs: 1, draftRefs: 0 } })
    expect(plan.errors).toEqual([])
    expect(plan.deletes).toEqual([])
    expect(plan.keeps.sort()).toEqual(['a', 'b'])
  })

  it('只有 1 行且无引用 → 保留不删（不删到空）', () => {
    const plan = planDemoDrugCleanup([row('a', 'ocr_matched')], { a: NONE })
    expect(plan.deletes).toEqual([])
    expect(plan.keeps).toEqual(['a'])
    expect(plan.keepReasons.a).toContain('不删到空')
  })

  it('无引用多行 → 按状态优先级保留 transcribed 1 行，其余可删', () => {
    const plan = planDemoDrugCleanup(
      [row('a', 'ocr_matched'), row('b', 'manual'), row('c', 'transcribed')],
      { a: NONE, b: NONE, c: NONE },
    )
    expect(plan.keeps).toEqual(['c'])
    expect(plan.deletes.sort()).toEqual(['a', 'b'])
  })

  it('draft 引用也保护', () => {
    const plan = planDemoDrugCleanup([row('a', 'ocr_matched'), row('b', 'ocr_matched')], { a: { planRefs: 0, riskEventRefs: 0, draftRefs: 1 }, b: NONE })
    expect(plan.keeps).toEqual(['a'])
    expect(plan.deletes).toEqual(['b'])
  })

  it('空分组 → 报错可见', () => {
    const plan = planDemoDrugCleanup([], {})
    expect(plan.errors.length).toBeGreaterThan(0)
    expect(plan.deletes).toEqual([])
  })
})
