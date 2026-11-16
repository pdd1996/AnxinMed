/**
 * M8-T3 · DXY 回填规划器单测。
 */
import { describe, it, expect } from 'vitest'
import { fallbackContentHash } from '../db/identity.js'
import { planDxyBackfill, type DxyDraft, type DxyInsertRow } from '../services/review/dxy-backfill.js'

const SECTIONS = { 成份: '玻璃酸钠', 规格: '0.1%', 注意事项: '本品不能和其他眼科用药同时使用。', 药物相互作用: '' }

function draft(overrides: Partial<DxyDraft> = {}): DxyDraft {
  return {
    drugId: 'drug-hycosan-01',
    version: 'dxy-2022-12-28',
    sourceUrl: 'https://drugs.dxy.cn/pc/drug/pFa0',
    sections: SECTIONS,
    ...overrides,
  }
}

function row(overrides: Partial<DxyInsertRow> = {}): DxyInsertRow {
  return {
    id: 'pi-dxy-1',
    drugId: 'drug-hycosan-01',
    source: '丁香园用药助手（说明书修改日期 2022-12-28）',
    version: 'dxy-2022-12-28',
    sourceUrl: 'https://drugs.dxy.cn/pc/drug/pFa0',
    curationStatus: 'crawled',
    sourceSections: {},
    contentHash: null,
    curationNote: '【爬虫草稿导入·未人工核对】',
    ...overrides,
  }
}

describe('planDxyBackfill · DXY 15 行回填', () => {
  it('空 sections + 空 hash → 生成回填（含 contentHash 与备注）', () => {
    const plan = planDxyBackfill([draft()], [row()])
    expect(plan.errors).toEqual([])
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].sections).toEqual(SECTIONS)
    expect(plan.updates[0].contentHash).toBe(fallbackContentHash(SECTIONS))
    expect(plan.updates[0].curationNote).toContain('M8 回填 source_sections/content_hash')
  })

  it('已回填且一致 → unchanged（幂等）', () => {
    const plan = planDxyBackfill(
      [draft()],
      [row({ sourceSections: SECTIONS, contentHash: fallbackContentHash(SECTIONS), curationNote: 'M8 回填 source_sections/content_hash（来源）' })],
    )
    expect(plan.errors).toEqual([])
    expect(plan.updates).toEqual([])
    expect(plan.unchanged).toEqual(['drug-hycosan-01'])
  })

  it('jsonb 回读键序不同不算内容不一致（幂等）', () => {
    const reversed = Object.fromEntries(Object.entries(SECTIONS).reverse())
    const plan = planDxyBackfill(
      [draft()],
      [row({ sourceSections: reversed, contentHash: fallbackContentHash(SECTIONS), curationNote: 'M8 回填 source_sections/content_hash（来源）' })],
    )
    expect(plan.errors).toEqual([])
    expect(plan.updates).toEqual([])
    expect(plan.unchanged).toEqual(['drug-hycosan-01'])
  })

  it('库内 sections 非空且与草稿不一致 → 拒绝覆盖', () => {
    const plan = planDxyBackfill([draft()], [row({ sourceSections: { 成份: '别的' } })])
    expect(plan.errors.some((e) => e.includes('拒绝覆盖'))).toBe(true)
    expect(plan.updates).toEqual([])
  })

  it('reviewed 行 → 拒绝回填', () => {
    const plan = planDxyBackfill([draft()], [row({ curationStatus: 'reviewed' })])
    expect(plan.errors.some((e) => e.includes('已 reviewed'))).toBe(true)
  })

  it('非丁香园来源 → 拒绝', () => {
    const plan = planDxyBackfill([draft()], [row({ source: '说明书 PDF' })])
    expect(plan.errors.some((e) => e.includes('不是丁香园来源'))).toBe(true)
  })

  it('缺草稿 / version 不一致 / sourceUrl 不一致 → 报错', () => {
    expect(planDxyBackfill([], [row()]).errors.some((e) => e.includes('找不到对应草稿'))).toBe(true)
    expect(planDxyBackfill([draft()], [row({ version: 'dxy-2024-01-01' })]).errors.some((e) => e.includes('version 不一致'))).toBe(true)
    expect(planDxyBackfill([draft()], [row({ sourceUrl: 'https://example.org' })]).errors.some((e) => e.includes('sourceUrl 不一致'))).toBe(true)
  })

  it('备注追加幂等：已有 M8 标记不重复追加', () => {
    const plan = planDxyBackfill(
      [draft()],
      [row({ curationNote: '【爬虫草稿导入·未人工核对】；M8 回填 source_sections/content_hash（来源：旧）' })],
    )
    expect(plan.updates[0].curationNote).toBe('【爬虫草稿导入·未人工核对】；M8 回填 source_sections/content_hash（来源：旧）')
  })
})
