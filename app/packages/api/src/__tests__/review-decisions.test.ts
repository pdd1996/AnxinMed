import { describe, expect, it } from 'vitest'
import {
  planItem,
  REQUIRED_SECTIONS,
  ReviewDecisionsSchema,
  type InsertSnapshot,
  type ReviewDecisionItem,
} from '../services/review/decisions.js'

const snapshot: InsertSnapshot = {
  insertId: 'pi-1',
  drugId: 'drug-1',
  curationStatus: 'crawled',
  contentHash: 'hash-1',
  sourceSections: {
    适应症: '适应症正文',
    禁忌: '禁忌正文',
    注意事项: '注意事项正文',
    不良反应: '不良反应正文',
    药物相互作用: '相互作用正文',
    用法用量: '用法用量正文',
  },
  indication: '适应症正文',
  contraindications: ['禁忌正文'],
  precautions: ['注意事项正文'],
  adverseReactions: '不良反应正文',
  interactions: '相互作用正文',
  dosage: { raw: '用法用量正文' },
}

function decision(overrides: Partial<ReviewDecisionItem> = {}): ReviewDecisionItem {
  const sections = Object.fromEntries(REQUIRED_SECTIONS.map((s) => [s.key, { status: 'verified' as const }]))
  return {
    insertId: 'pi-1',
    drugId: 'drug-1',
    contentHash: 'hash-1',
    action: 'promote',
    identityConfirmed: true,
    optionalConfirmed: true,
    rejectReason: '',
    sections,
    ...overrides,
  }
}

describe('planItem', () => {
  it('完整通过 → 生成 six-section reviewMeta', () => {
    const plan = planItem(decision(), snapshot)
    expect(plan.errors).toEqual([])
    expect(plan.reviewMeta?.sections).toMatchObject({ indication: 'verified', dosage: 'verified' })
    expect(plan.reviewMeta?.optionalSections).toBe('verified')
    expect(plan.corrections).toEqual([])
  })

  it('身份未确认 → 报错', () => {
    const plan = planItem(decision({ identityConfirmed: false }), snapshot)
    expect(plan.errors).toContain('身份字段未确认')
  })

  it('必核段未处置 → 报错', () => {
    const sections = decision().sections
    delete sections.dosage
    const plan = planItem(decision({ sections }), snapshot)
    expect(plan.errors.some((e) => e.includes('用法用量'))).toBe(true)
  })

  it('正文为空不能标与源文一致', () => {
    const sections = { ...decision().sections, dosage: { status: 'verified' as const } }
    const empty = { ...snapshot, sourceSections: { ...snapshot.sourceSections, 用法用量: '' }, dosage: null }
    const plan = planItem(decision({ sections }), empty)
    expect(plan.errors.some((e) => e.includes('正文为空'))).toBe(true)
  })

  it('有正文不能标源文无此段', () => {
    const sections = { ...decision().sections, interactions: { status: 'source-missing' as const } }
    const plan = planItem(decision({ sections }), snapshot)
    expect(plan.errors.some((e) => e.includes('不能标「源文无此段」'))).toBe(true)
  })

  it('修正缺原因 → 报错；带正文与原因 → 生成 sourceKey/mapped 修正', () => {
    const bad = { ...decision().sections, dosage: { status: 'corrected' as const, text: '新正文' } }
    expect(planItem(decision({ sections: bad }), snapshot).errors.some((e) => e.includes('未填原因'))).toBe(true)

    const good = { ...decision().sections, dosage: { status: 'corrected' as const, text: '新正文', reason: '原文缺字' } }
    const plan = planItem(decision({ sections: good }), snapshot)
    expect(plan.errors).toEqual([])
    expect(plan.corrections).toHaveLength(1)
    expect(plan.corrections[0]).toMatchObject({ field: 'dosage', sourceKey: '用法用量', to: '新正文', reason: '原文缺字' })
    expect(plan.reviewMeta?.corrections).toHaveLength(1)
  })

  it('功能主治别名 → 修正写到源文实际段名', () => {
    const sections = { ...decision().sections, indication: { status: 'corrected' as const, text: '新适应症', reason: '纠错' } }
    const alt = {
      ...snapshot,
      indication: '',
      sourceSections: { ...snapshot.sourceSections, 适应症: '', 功能主治: '功能主治正文' },
    }
    const plan = planItem(decision({ sections }), alt)
    expect(plan.corrections[0].sourceKey).toBe('功能主治')
    expect(plan.corrections[0].from).toBe('功能主治正文')
  })

  it('contentHash 变化 → stale 报错', () => {
    const plan = planItem(decision({ contentHash: 'hash-2' }), snapshot)
    expect(plan.errors.some((e) => e.includes('stale'))).toBe(true)
  })

  it('已 reviewed → 幂等跳过', () => {
    const plan = planItem(decision(), { ...snapshot, curationStatus: 'reviewed' })
    expect(plan.errors).toEqual([])
    expect(plan.note).toContain('已 reviewed')
  })

  it('退回必须有原因', () => {
    expect(planItem(decision({ action: 'reject' }), snapshot).errors).toContain('退回必须写原因')
    expect(planItem(decision({ action: 'reject', rejectReason: '源文缺页' }), snapshot).errors).toEqual([])
  })

  it('跳过不校验段', () => {
    const plan = planItem(decision({ action: 'skip', identityConfirmed: false, sections: {} }), snapshot)
    expect(plan.errors).toEqual([])
    expect(plan.note).toBe('本批跳过')
  })
})

describe('ReviewDecisionsSchema', () => {
  it('核对人不能为空', () => {
    const result = ReviewDecisionsSchema.safeParse({
      schemaVersion: 1,
      batchId: 'b1',
      reviewer: ' ',
      exportedAt: '2026-11-07T00:00:00Z',
      items: [decision()],
    })
    expect(result.success).toBe(false)
  })
})
