/**
 * M6-T9 核对应用：测试库真实落库验证（reviewed / 修正 / 退回 / stale）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { manualReviewLog, packageInserts } from '../db/schema.js'
import { applyDecisions } from '../services/review/apply.js'
import { REQUIRED_SECTIONS, ReviewDecisionsSchema, type ReviewDecisionItem } from '../services/review/decisions.js'

const PREFIX = 'pi-review-test-'
const BASE_SECTIONS = {
  适应症: '适应症正文',
  禁忌: '禁忌正文',
  注意事项: '注意事项正文',
  不良反应: '不良反应正文',
  药物相互作用: '相互作用正文',
  用法用量: '用法用量正文',
}

async function seedRow(suffix: string) {
  const id = `${PREFIX}${suffix}`
  await db.insert(packageInserts).values({
    id,
    drugId: `drug-review-test-${suffix}`,
    genericName: `核对测试药${suffix}`,
    form: '片',
    specification: '10mg',
    indication: BASE_SECTIONS.适应症,
    contraindications: [BASE_SECTIONS.禁忌],
    precautions: [BASE_SECTIONS.注意事项],
    adverseReactions: BASE_SECTIONS.不良反应,
    interactions: BASE_SECTIONS.药物相互作用,
    dosage: { raw: BASE_SECTIONS.用法用量 },
    sourceSections: BASE_SECTIONS,
    contentHash: `hash-${suffix}`,
    curationStatus: 'crawled',
    version: 'test-1',
    source: '说明书 PDF（测试）',
  })
  return id
}

function decision(id: string, suffix: string, overrides: Partial<ReviewDecisionItem> = {}): ReviewDecisionItem {
  const sections = Object.fromEntries(REQUIRED_SECTIONS.map((s) => [s.key, { status: 'verified' as const }]))
  return {
    insertId: id,
    drugId: `drug-review-test-${suffix}`,
    contentHash: `hash-${suffix}`,
    action: 'promote',
    identityConfirmed: true,
    optionalConfirmed: true,
    rejectReason: '',
    sections,
    ...overrides,
  }
}

function batch(items: ReviewDecisionItem[]) {
  return ReviewDecisionsSchema.parse({
    schemaVersion: 1,
    batchId: 'batch-test',
    reviewer: '测试员',
    exportedAt: '2026-11-07T00:00:00Z',
    items,
  })
}

afterAll(async () => {
  await db.delete(manualReviewLog).where(like(manualReviewLog.insertId, `${PREFIX}%`))
  await db.delete(packageInserts).where(like(packageInserts.id, `${PREFIX}%`))
})

describe('applyDecisions', () => {
  it('dry-run 不落库；真导升 reviewed 并写 meta/日志', async () => {
    const id = await seedRow('a')
    const decisions = batch([decision(id, 'a')])

    const dry = await applyDecisions(decisions, '测试员', { dryRun: true })
    expect(dry.errors).toEqual([])
    expect(dry.counts.promote).toBe(1)
    expect((await db.select().from(packageInserts)).find((r) => r.id === id)?.curationStatus).toBe('crawled')

    const real = await applyDecisions(decisions, '测试员')
    expect(real.errors).toEqual([])
    const row = (await db.select().from(packageInserts)).find((r) => r.id === id)!
    expect(row.curationStatus).toBe('reviewed')
    expect(row.reviewedBy).toBe('测试员')
    expect(row.reviewMeta?.sections).toMatchObject({ indication: 'verified', dosage: 'verified' })
    const logs = (await db.select().from(manualReviewLog)).filter((l) => l.insertId === id)
    expect(logs.map((l) => l.action)).toEqual(['promote'])
  })

  it('段修正写回 sourceSections 与结构化列，并留 correct 日志', async () => {
    const id = await seedRow('b')
    const sections: Record<string, { status: 'verified' | 'source-missing' | 'corrected'; text?: string; reason?: string }> =
      Object.fromEntries(REQUIRED_SECTIONS.map((s) => [s.key, { status: 'verified' as const }]))
    sections.dosage = { status: 'corrected', text: '修正后的用法用量', reason: '原文缺字' }
    const decisions = batch([decision(id, 'b', { sections })])

    const result = await applyDecisions(decisions, '测试员')
    expect(result.errors).toEqual([])
    const row = (await db.select().from(packageInserts)).find((r) => r.id === id)!
    expect(row.dosage).toMatchObject({ raw: '修正后的用法用量' })
    expect(row.sourceSections?.用法用量).toBe('修正后的用法用量')
    expect(row.reviewMeta?.corrections?.[0]).toMatchObject({ field: 'dosage', reason: '原文缺字' })
    const logs = (await db.select().from(manualReviewLog)).filter((l) => l.insertId === id)
    expect(logs.map((l) => l.action).sort()).toEqual(['correct', 'promote'])
  })

  it('退回只写日志、不改状态', async () => {
    const id = await seedRow('c')
    const decisions = batch([decision(id, 'c', { action: 'reject', rejectReason: '源文缺页' })])
    const result = await applyDecisions(decisions, '测试员')
    expect(result.errors).toEqual([])
    expect(result.counts.reject).toBe(1)
    const row = (await db.select().from(packageInserts)).find((r) => r.id === id)!
    expect(row.curationStatus).toBe('crawled')
    const logs = (await db.select().from(manualReviewLog)).filter((l) => l.insertId === id)
    expect(logs.map((l) => l.action)).toEqual(['reject'])
  })

  it('contentHash stale → 整批报错且不写', async () => {
    const id = await seedRow('d')
    const decisions = batch([decision(id, 'd', { contentHash: 'hash-stale' })])
    const result = await applyDecisions(decisions, '测试员')
    expect(result.errors.some((e) => e.includes('stale'))).toBe(true)
    const row = (await db.select().from(packageInserts)).find((r) => r.id === id)!
    expect(row.curationStatus).toBe('crawled')
  })
})
