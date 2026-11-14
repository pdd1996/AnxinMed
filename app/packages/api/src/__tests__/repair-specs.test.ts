/**
 * 规格修复规划器单测（M6-T9-fix，2026-11-14）。
 *
 * 只测纯函数 planRepair：不连库、不起服务；夹具模拟「旧规格局面 → 修正草稿」。
 */
import { describe, expect, it } from 'vitest'
import { makeIdentityKey } from '../db/identity.js'
import {
  insertIdFor,
  normalizeSpec,
  planRepair,
  type InsertLite,
  type MasterLite,
  type PlanContext,
  type RepairOps,
} from '../services/review/spec-repair.js'
import type { Draft } from '../db/manual-draft.js'

const PDF = '阿卡波糖片[340120,340121].pdf'

function draft(drugId: string, specification: string): Draft {
  return {
    source: 'manual-pdf',
    sourceFile: PDF,
    sourceRecordIds: [],
    extractedAt: '2026-11-14T00:00:00Z',
    pdfCreatedAt: null,
    extractorVersion: 'manual-pdf-2026-11-14',
    pageCount: 1,
    sourceFileHash: null,
    contentHash: null,
    drugId,
    genericName: '阿卡波糖片',
    brandName: null,
    englishName: null,
    pinyin: null,
    form: '片',
    productType: '化学药',
    specification,
    approvalNumbers: ['国药准字H19990205'],
    manufacturer: '拜耳医药保健有限公司',
    repackager: null,
    executionStandard: null,
    shelfLife: null,
    version: 'nmpa-YBH06432018',
    sections: { 规格: specification },
    curationStatus: 'crawled',
    curationNote: '',
  }
}

function identityOf(d: Draft): string {
  return makeIdentityKey({
    genericName: d.genericName,
    specification: d.specification,
    form: d.form,
    manufacturer: d.manufacturer,
    approvalNumbers: d.approvalNumbers,
  })
}

function insertRow(over: Partial<InsertLite> & Pick<InsertLite, 'id' | 'drugId'>): InsertLite {
  return {
    sourceFile: PDF,
    version: 'nmpa-YBH06432018',
    sourceDocumentId: 'sd-abcdef0123456789',
    specification: '1g',
    curationStatus: 'crawled',
    reviewedBy: null,
    ...over,
  }
}

function context(inserts: InsertLite[], masters: MasterLite[], drafts: Draft[]): PlanContext {
  return {
    insertsByKey: new Map(inserts.filter((r) => r.sourceFile).map((r) => [`${r.drugId}|${r.sourceFile}`, r])),
    insertsById: new Map(inserts.map((r) => [r.id, r])),
    masters: new Map(masters.map((m) => [m.id, m])),
    drafts: new Map(drafts.map((d) => [d.drugId, d])),
    userRefs: new Map(),
    ruleRefs: new Map(),
  }
}

function ops(items: RepairOps['ops']): RepairOps {
  return { schemaVersion: 1, pdfCount: 1, ops: items }
}

describe('planRepair · update-spec', () => {
  it('同 drugId 改规格：只改文本，不迁移行', () => {
    const row = insertRow({ id: 'pi-drug-a@nmpa-x-1234abcd', drugId: 'drug-a', specification: '1g' })
    const ctx = context([row], [{ id: 'drug-a', identityKey: 'old', curationStatus: 'crawled' }], [draft('drug-a', '0.1g')])
    const plan = planRepair(ops([{ op: 'update-spec', pdf: PDF, fromId: 'drug-a', toId: 'drug-a', fromSpec: '1g', toSpec: '0.1g', reviewed: false }]), ctx)
    expect(plan.errors).toEqual([])
    expect(plan.counts).toEqual({ delete: 0, updateSpec: 1, rename: 0, moveMaster: 0, cloneMaster: 0 })
    expect(plan.steps).toEqual([
      { kind: 'update-spec', insertId: row.id, drugId: 'drug-a', fromSpec: '1g', toSpec: '0.1g', reviewed: false },
    ])
  })

  it('改规格时身份指纹与库内其它产品撞车 → 拒绝', () => {
    const row = insertRow({ id: 'pi-drug-a@nmpa-x-1234abcd', drugId: 'drug-a', specification: '1g' })
    const d = draft('drug-a', '0.1g')
    const ctx = context(
      [row],
      [
        { id: 'drug-a', identityKey: 'old-a', curationStatus: 'crawled' },
        { id: 'drug-other', identityKey: identityOf(d), curationStatus: 'crawled' },
      ],
      [d],
    )
    const plan = planRepair(ops([{ op: 'update-spec', pdf: PDF, fromId: 'drug-a', toId: 'drug-a', fromSpec: '1g', toSpec: '0.1g', reviewed: false }]), ctx)
    expect(plan.errors.some((e) => e.includes('身份指纹撞车'))).toBe(true)
  })
})

describe('planRepair · rename', () => {
  it('改名：说明书行迁移到新 id，旧产品行无其它引用 → 原地改 id', () => {
    const row = insertRow({ id: insertIdFor('drug-a-1g', 'nmpa-x', 'sd-abcdef0123456789'), drugId: 'drug-a-1g' })
    const ctx = context(
      [row],
      [{ id: 'drug-a-1g', identityKey: 'old', curationStatus: 'crawled' }],
      [draft('drug-a-0p1g', '0.1g')],
    )
    const plan = planRepair(ops([{ op: 'rename', pdf: PDF, fromId: 'drug-a-1g', toId: 'drug-a-0p1g', fromSpec: '1g', toSpec: '0.1g', reviewed: false }]), ctx)
    expect(plan.errors).toEqual([])
    expect(plan.steps).toHaveLength(1)
    const step = plan.steps[0]
    expect(step.kind).toBe('rename')
    if (step.kind === 'rename') {
      expect(step.fromDrugId).toBe('drug-a-1g')
      expect(step.toDrugId).toBe('drug-a-0p1g')
      expect(step.toInsertId).toBe(insertIdFor('drug-a-0p1g', 'nmpa-YBH06432018', 'sd-abcdef0123456789'))
      expect(step.moveMaster).toBe(true)
    }
    expect(plan.counts.rename).toBe(1)
    expect(plan.counts.moveMaster).toBe(1)
  })

  it('目标 drugId 已被占用 → 拒绝', () => {
    const row = insertRow({ id: 'pi-x', drugId: 'drug-a-1g' })
    const ctx = context(
      [row, insertRow({ id: 'pi-y', drugId: 'drug-a-0p1g', specification: '0.1g' })],
      [
        { id: 'drug-a-1g', identityKey: 'old', curationStatus: 'crawled' },
        { id: 'drug-a-0p1g', identityKey: 'other', curationStatus: 'crawled' },
      ],
      [draft('drug-a-0p1g', '0.1g')],
    )
    const plan = planRepair(ops([{ op: 'rename', pdf: PDF, fromId: 'drug-a-1g', toId: 'drug-a-0p1g', fromSpec: '1g', toSpec: '0.1g', reviewed: false }]), ctx)
    expect(plan.errors.some((e) => e.includes('已被占用'))).toBe(true)
  })

  it('草稿规格与操作不一致 → 拒绝', () => {
    const row = insertRow({ id: 'pi-x', drugId: 'drug-a-1g' })
    const ctx = context([row], [{ id: 'drug-a-1g', identityKey: 'old', curationStatus: 'crawled' }], [draft('drug-a-0p1g', '0.2g')])
    const plan = planRepair(ops([{ op: 'rename', pdf: PDF, fromId: 'drug-a-1g', toId: 'drug-a-0p1g', fromSpec: '1g', toSpec: '0.1g', reviewed: false }]), ctx)
    expect(plan.errors.some((e) => e.includes('草稿规格与操作不一致'))).toBe(true)
  })
})

describe('planRepair · delete', () => {
  it('删切片行：行与孤儿产品行一起删', () => {
    const keep = insertRow({ id: 'pi-keep', drugId: 'drug-a', specification: '0.1g' })
    const drop = insertRow({ id: 'pi-drop', drugId: 'drug-a-5', specification: '5g' })
    const ctx = context(
      [keep, drop],
      [
        { id: 'drug-a', identityKey: 'a', curationStatus: 'crawled' },
        { id: 'drug-a-5', identityKey: 'b', curationStatus: 'crawled' },
      ],
      [draft('drug-a', '0.1g')],
    )
    const plan = planRepair(ops([{ op: 'delete', pdf: PDF, drugId: 'drug-a-5', reason: '并入 drug-a', reviewed: false }]), ctx)
    expect(plan.errors).toEqual([])
    expect(plan.steps.filter((s) => s.kind === 'delete-insert')).toHaveLength(1)
    expect(plan.steps.filter((s) => s.kind === 'delete-master').map((s) => (s.kind === 'delete-master' ? s.masterId : ''))).toEqual(['drug-a-5'])
  })

  it('reviewed 行拒绝删除', () => {
    const drop = insertRow({ id: 'pi-drop', drugId: 'drug-r', curationStatus: 'reviewed', reviewedBy: 'paddy' })
    const ctx = context([drop], [{ id: 'drug-r', identityKey: 'r', curationStatus: 'reviewed' }], [draft('drug-a', '0.1g')])
    const plan = planRepair(ops([{ op: 'delete', pdf: PDF, drugId: 'drug-r', reason: 'x', reviewed: true }]), ctx)
    expect(plan.errors.some((e) => e.includes('拒绝删除 reviewed'))).toBe(true)
    expect(plan.steps).toEqual([])
  })

  it('产品行仍被用户药箱引用 → 保留产品行并告警', () => {
    const drop = insertRow({ id: 'pi-drop', drugId: 'drug-r' })
    const ctx = context([drop], [{ id: 'drug-r', identityKey: 'r', curationStatus: 'crawled' }], [draft('drug-a', '0.1g')])
    ctx.userRefs.set('drug-r', 2)
    const plan = planRepair(ops([{ op: 'delete', pdf: PDF, drugId: 'drug-r', reason: 'x', reviewed: false }]), ctx)
    expect(plan.steps.some((s) => s.kind === 'delete-master')).toBe(false)
    expect(plan.warnings.some((w) => w.includes('用户药箱'))).toBe(true)
  })
})

describe('planRepair · 行定位', () => {
  it('按 drugId+PDF 定位；行不存在时报错而不是猜', () => {
    const ctx = context([], [], [draft('drug-a', '0.1g')])
    const plan = planRepair(ops([{ op: 'update-spec', pdf: PDF, fromId: 'drug-missing', toId: 'drug-missing', fromSpec: 'x', toSpec: '0.1g', reviewed: false }]), ctx)
    expect(plan.errors.some((e) => e.includes('行不存在'))).toBe(true)
  })
})

describe('normalizeSpec / insertIdFor', () => {
  it('规格比较忽略空白', () => {
    expect(normalizeSpec('3ml：300单位/支')).toBe(normalizeSpec('3ml： 300 单位/支'))
    expect(normalizeSpec('0.1g')).not.toBe(normalizeSpec('1g'))
  })

  it('说明书行 ID 与 import-manuals 同构', () => {
    expect(insertIdFor('drug-a', 'nmpa-X', 'sd-abcdef0123456789')).toBe('pi-drug-a@nmpa-X-abcdef01')
  })
})
