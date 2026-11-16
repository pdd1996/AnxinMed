/**
 * 说明书内容修复规划器单测（M7-T5，2026-11-15）。
 *
 * 只测纯函数 planManualRepair / completeness：不连库、不读文件；夹具模拟
 * 「M6 旧草稿入库 → M7 重提取草稿」的格局。
 */
import { describe, expect, it } from 'vitest'
import { makeIdentityKey } from '../db/identity.js'
import type { Draft } from '../db/manual-draft.js'
import {
  completeness,
  contentCharCounts,
  draftKey,
  planManualRepair,
  type InsertLite,
  type MasterLite,
  type RepairContext,
} from '../services/review/manual-repair.js'

const PDF = '度拉糖肽注射液[407023,407024].pdf'
const SEPS = '| --- | --- | --- |'

function draft(over: Partial<Draft> = {}): Draft {
  return {
    source: 'manual-pdf',
    sourceFile: PDF,
    sourceRecordIds: [],
    extractedAt: '2026-11-15T00:00:00Z',
    pdfCreatedAt: null,
    extractorVersion: 'manual-pdf-2026-11-15',
    pageCount: 22,
    sourceFileHash: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    drugId: 'drug-dulaglutide-0p75mg',
    genericName: '度拉糖肽注射液',
    brandName: null,
    englishName: null,
    pinyin: null,
    form: '注射液',
    productType: '化学药',
    specification: '0.75mg：0.5ml',
    approvalNumbers: ['国药准字H20000065'],
    manufacturer: '某制药有限公司',
    repackager: null,
    executionStandard: 'YBH00012020',
    shelfLife: '24个月',
    version: 'nmpa-YBH00012020',
    sections: { 不良反应: '常见：恶心、腹泻。', 用法用量: '每次 0.75mg。' },
    curationStatus: 'crawled',
    curationNote: '',
    ...over,
  }
}

function insert(over: Partial<InsertLite> = {}): InsertLite {
  return {
    id: 'pi-drug-dulaglutide-0p75mg@nmpa-YBH00012020-abcdef01',
    drugId: 'drug-dulaglutide-0p75mg',
    sourceFile: PDF,
    sourceDocumentId: 'sd-abcdef0123456789',
    version: 'nmpa-YBH00012020',
    curationStatus: 'crawled',
    specification: '0.75mg：0.5ml',
    brandName: null,
    approvalNumbers: ['国药准字H20000065'],
    sourceSections: { 不良反应: '常见：恶心、腹泻。', 用法用量: '每次 0.75mg。' },
    ...over,
  }
}

function master(over: Partial<MasterLite> = {}): MasterLite {
  return {
    id: 'drug-dulaglutide-0p75mg',
    identityKey: makeIdentityKey({
      genericName: '度拉糖肽注射液',
      specification: '0.75mg：0.5ml',
      form: '注射液',
      manufacturer: '某制药有限公司',
      approvalNumbers: ['国药准字H20000065'],
    }),
    curationStatus: 'crawled',
    brandName: null,
    specification: '0.75mg：0.5ml',
    approvalNumber: '国药准字H20000065',
    approvalNumbers: ['国药准字H20000065'],
    ...over,
  }
}

function context(inserts: InsertLite[], masters: MasterLite[]): RepairContext {
  return {
    insertsByKey: new Map(inserts.filter((r) => r.sourceFile).map((r) => [draftKey(r.drugId, r.sourceFile), r])),
    insertsById: new Map(inserts.map((r) => [r.id, r])),
    masters: new Map(masters.map((m) => [m.id, m])),
    userRefs: new Map(),
    ruleRefs: new Map(),
  }
}

describe('completeness · 字符完整性', () => {
  it('Markdown 分隔行、管道符与空白不算增删', () => {
    const before = { 不良反应: '常见：恶心、腹泻。' }
    const after = { 不良反应: '| 系统器官 | 频率 |\n| --- | --- |\n| 恶心、腹泻 | 常见 |' }
    expect(completeness(before, after).lostRatio).toBeLessThanOrEqual(1)
  })

  it('丢字可被检出', () => {
    const comp = completeness({ 不良反应: '恶心、腹泻。' }, { 不良反应: '恶心。' })
    expect(comp.lost).toBe(3) // 、腹 泻
    expect(comp.lostRatio).toBeCloseTo(3 / 6)
  })

  it('contentCharCounts 去空白留正文', () => {
    const counts = contentCharCounts({ a: '甲 乙\n丙' })
    expect(counts.get('甲')).toBe(1)
    expect(counts.get(' ')).toBeUndefined()
  })
})

describe('planManualRepair · 行内容更新', () => {
  it('内容一致 → 不变', () => {
    const plan = planManualRepair([draft()], context([insert()], [master()]))
    expect(plan.counts.unchanged).toBe(1)
    expect(plan.updates).toHaveLength(0)
    expect(plan.errors).toEqual([])
  })

  it('jsonb 键序不同不算变化（PostgreSQL jsonb 会重排键）', () => {
    const d = draft({ sections: { 用法用量: '每次 0.75mg。', 不良反应: '常见：恶心、腹泻。' } })
    const row = insert({
      sourceSections: { 不良反应: '常见：恶心、腹泻。', 用法用量: '每次 0.75mg。' },
    })
    const plan = planManualRepair([d], context([row], [master()]))
    expect(plan.counts.unchanged).toBe(1)
    expect(plan.updates).toHaveLength(0)
  })

  it('表格重建后的段落变化 → 更新行并记录段落差异', () => {
    const d = draft({ sections: { 不良反应: '| 系统器官 | 频率 |\n| --- | --- |\n| 恶心 | 常见 |', 用法用量: '每次 0.75mg。' } })
    const plan = planManualRepair([d], context([insert()], [master()]))
    expect(plan.counts.update).toBe(1)
    const update = plan.updates[0]
    expect(update.changedSections['不良反应']).toMatchObject({ hasTable: true })
    expect(update.values.adverseReactions).toContain('| 系统器官 |')
  })

  it('reviewed 行内容变化 → reviewedUpdate，不降级', () => {
    const d = draft({ sections: { 不良反应: '| 系统器官 | 频率 |\n| --- | --- |\n| 恶心 | 常见 |', 用法用量: '每次 0.75mg。' } })
    const plan = planManualRepair([d], context([insert({ curationStatus: 'reviewed' })], [master({ curationStatus: 'reviewed' })]))
    expect(plan.counts.reviewedUpdate).toBe(1)
    expect(plan.updates[0].reviewed).toBe(true)
  })

  it('丢字超阈值 → 拒绝整批', () => {
    const d = draft({ sections: { 不良反应: '常见。', 用法用量: '每次 0.75mg。' } })
    const plan = planManualRepair([d], context([insert()], [master()]))
    expect(plan.errors.join('')).toContain('丢字超阈值')
  })

  it('商品名/批准文号变化 → 同步产品行', () => {
    const d = draft({
      brandName: '度易达',
      approvalNumbers: ['国药准字H20000066'],
      sections: { 不良反应: '常见：恶心、腹泻。', 用法用量: '每次 0.75mg。' },
    })
    const plan = planManualRepair([d], context([insert()], [master()]))
    expect(plan.counts.masterUpdate).toBe(1)
    const m = plan.masterUpdates[0]
    expect(m.fields.brandName).toBe('度易达')
    expect(m.fields.approvalNumbers).toEqual(['国药准字H20000066'])
    expect(m.fields.identityKey).not.toBe(master().identityKey)
  })

  it('规格变化 → 同步产品行规格与指纹', () => {
    const d = draft({ specification: '1.5mg：0.5ml' })
    const plan = planManualRepair([d], context([insert()], [master()]))
    expect(plan.masterUpdates[0].fields.specification).toBe('1.5mg：0.5ml')
    expect(plan.masterUpdates[0].changed).toContain('identityKey')
  })
})

describe('planManualRepair · 增删与校验', () => {
  it('新草稿（库内无行）→ newDrafts', () => {
    const plan = planManualRepair([draft()], context([], [master()]))
    expect(plan.counts.newDraft).toBe(1)
    expect(plan.newDrafts[0].drugId).toBe('drug-dulaglutide-0p75mg')
  })

  it('crawled 行没有对应草稿 → 删行', () => {
    const plan = planManualRepair([], context([insert()], [master()]))
    expect(plan.counts.delete).toBe(1)
    expect(plan.deletes[0].insertId).toBe(insert().id)
  })

  it('reviewed 行没有对应草稿 → 报错，不删', () => {
    const plan = planManualRepair([], context([insert({ curationStatus: 'reviewed' })], [master()]))
    expect(plan.counts.delete).toBe(0)
    expect(plan.errors.join('')).toContain('拒绝删除')
  })

  it('身份指纹撞车 → 报错', () => {
    const other = master({
      id: 'drug-other',
      identityKey: makeIdentityKey({
        genericName: '度拉糖肽注射液',
        specification: '1.5mg：0.5ml',
        form: '注射液',
        manufacturer: '某制药有限公司',
        approvalNumbers: ['国药准字H20000065'],
      }),
      specification: '1.5mg：0.5ml',
    })
    const d = draft({ specification: '1.5mg：0.5ml' })
    const plan = planManualRepair([d], context([insert()], [master(), other]))
    expect(plan.errors.join('')).toContain('身份指纹撞车')
  })

  it('丁香园来源（无 sourceFile）不参与删行', () => {
    const dxy = insert({ id: 'pi-dxy-1', drugId: 'drug-dxy', sourceFile: null })
    const plan = planManualRepair([], context([dxy, insert()], [master(), master({ id: 'drug-dxy' })]))
    expect(plan.deletes.map((d) => d.insertId)).toEqual([insert().id])
  })
})
