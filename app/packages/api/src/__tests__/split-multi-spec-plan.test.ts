/**
 * 多规格拆行迁移 · 纯规划层单测（2026-11-20）。
 * 覆盖：拆行/收窄补丁、用户档案改指向、相互作用规则扩写、指纹撞车、源行漂移、迁移后校验。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeIdentityKey } from '../db/identity.js'
import {
  buildSplitPlan,
  SplitPlanError,
  verifyMigration,
  type InsertRow,
  type MasterRow,
  type RuleRow,
  type Snapshot,
  type SplitManifest,
} from '../db/split-multi-spec-plan.js'

const MFR = '深圳信立泰药业股份有限公司'

function master(over: Partial<MasterRow> & Pick<MasterRow, 'id' | 'genericName' | 'specification'>): MasterRow {
  const base = {
    brandName: null,
    form: '片',
    manufacturer: MFR,
    approvalNumber: null,
    approvalNumbers: null,
    note: null,
    ...over,
  }
  return {
    ...base,
    approvalNumber: base.approvalNumber ?? base.approvalNumbers?.[0] ?? null,
    identityKey: makeIdentityKey({
      genericName: base.genericName,
      specification: base.specification,
      form: base.form,
      manufacturer: base.manufacturer,
      approvalNumbers: base.approvalNumbers,
    }),
  }
}

const ALI = master({
  id: 'drug-alishatanzhi-pian-80mg',
  genericName: '阿利沙坦酯片',
  specification: '80mg，240mg',
  approvalNumbers: ['国药准字H20138001', '国药准字H20138002'],
})
const AML = master({
  id: 'drug-amlodipine-5',
  genericName: '苯磺酸氨氯地平片',
  specification: '5mg',
  approvalNumbers: ['国药准字H10950224', '国药准字H10950225'],
  manufacturer: '辉瑞制药有限公司',
})
const OTHER = master({
  id: 'drug-other-10',
  genericName: '其他药片',
  specification: '10mg',
  approvalNumbers: ['国药准字H20000001'],
  manufacturer: '某厂',
})

const ALI_240 = 'drug-alishatanzhi-pian-80mg-split-240mg'

const manifest: SplitManifest = {
  version: 1,
  date: '2026-11-20',
  expectedFlaggedBefore: 2,
  expectedFlaggedAfter: 0,
  splits: [
    {
      sourceId: ALI.id,
      expect: { specification: '80mg，240mg', approvalNumbers: ['国药准字H20138001', '国药准字H20138002'] },
      targets: [
        {
          id: ALI.id,
          action: 'update',
          specification: '80mg',
          approvalNumber: '国药准字H20138001',
          approvalNumbers: ['国药准字H20138001'],
        },
        {
          id: ALI_240,
          action: 'insert',
          specification: '240mg',
          approvalNumber: '国药准字H20138002',
          approvalNumbers: ['国药准字H20138002'],
        },
      ],
    },
  ],
  narrows: [
    {
      id: AML.id,
      expect: { approvalNumbers: ['国药准字H10950224', '国药准字H10950225'] },
      approvalNumber: '国药准字H10950224',
      approvalNumbers: ['国药准字H10950224'],
    },
  ],
}

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  const inserts: InsertRow[] = [
    { id: 'pi-ali', drugId: ALI.id, specification: '80mg，240mg', approvalNumbers: ALI.approvalNumbers, curationNote: null },
    { id: 'pi-aml', drugId: AML.id, specification: '5mg', approvalNumbers: AML.approvalNumbers, curationNote: null },
  ]
  return {
    masters: [ALI, AML, OTHER],
    inserts,
    userDrugs: [{ id: 'drug-user-1', drugMasterId: ALI.id, specification: '240mg×7片' }],
    rules: [{ id: 'rule-1', drugIds: [ALI.id, OTHER.id], drugGroups: [[ALI.id]] }] as RuleRow[],
    ...over,
  }
}

/** 内存里执行 plan，供校验测试用。 */
function applyPlan(snap: Snapshot, plan: ReturnType<typeof buildSplitPlan>): Snapshot {
  const masters = new Map(snap.masters.map((m) => [m.id, { ...m }]))
  for (const u of plan.masterUpdates) {
    const row = masters.get(u.id)!
    Object.assign(row, {
      specification: u.specification,
      approvalNumber: u.approvalNumber,
      approvalNumbers: u.approvalNumbers,
      identityKey: u.identityKey,
      note: u.note,
    })
  }
  for (const ins of plan.masterInserts) {
    const src = masters.get(ins.sourceId)!
    masters.set(ins.id, {
      ...src,
      id: ins.id,
      specification: ins.specification,
      approvalNumber: ins.approvalNumber,
      approvalNumbers: ins.approvalNumbers,
      identityKey: ins.identityKey,
      note: ins.note,
    })
  }
  const inserts = snap.inserts.map((i) => ({ ...i }))
  for (const u of plan.insertUpdates) {
    const row = inserts.find((i) => i.id === u.id)!
    row.specification = u.specification
    row.approvalNumbers = u.approvalNumbers
  }
  for (const c of plan.insertClones) {
    inserts.push({ id: `clone-${c.newDrugId}`, drugId: c.newDrugId, specification: c.specification, approvalNumbers: c.approvalNumbers, curationNote: c.note })
  }
  const userDrugs = snap.userDrugs.map((d) =>
    plan.userDrugUpdates.find((u) => u.id === d.id) ? { ...d, drugMasterId: plan.userDrugUpdates.find((u) => u.id === d.id)!.to } : { ...d },
  )
  const rules = snap.rules.map((r) => {
    const patch = plan.ruleUpdates.find((u) => u.id === r.id)
    return patch ? { ...r, drugIds: patch.drugIds, drugGroups: patch.drugGroups } : r
  })
  return { masters: [...masters.values()], inserts, userDrugs, rules }
}

describe('buildSplitPlan', () => {
  it('拆行 + 收窄 + 用户改指向 + 规则扩写，一次规划完整', () => {
    const plan = buildSplitPlan(snapshot(), manifest)

    expect(plan.masterUpdates.map((u) => u.id).sort()).toEqual([ALI.id, AML.id].sort())
    expect(plan.masterInserts).toHaveLength(1)
    expect(plan.masterInserts[0]).toMatchObject({
      id: ALI_240,
      sourceId: ALI.id,
      specification: '240mg',
      approvalNumber: '国药准字H20138002',
    })
    expect(plan.insertUpdates).toHaveLength(2)
    expect(plan.insertClones).toHaveLength(1)
    expect(plan.insertClones[0].newDrugId).toBe(ALI_240)

    expect(plan.userDrugUpdates).toEqual([{ id: 'drug-user-1', from: ALI.id, to: ALI_240 }])
    expect(plan.ruleUpdates).toHaveLength(1)
    expect(plan.ruleUpdates[0].drugIds).toEqual([ALI.id, ALI_240, OTHER.id])
    expect(plan.ruleUpdates[0].drugGroups).toEqual([[ALI.id, ALI_240]])

    expect(plan.stats).toMatchObject({ splits: 1, targets: 2, narrows: 1, flaggedBefore: 2, flaggedAfter: 0 })
  })

  it('新增行指纹与现有行撞车 → 预检中止', () => {
    const collide = master({
      id: 'drug-dup-240',
      genericName: '阿利沙坦酯片',
      specification: '240mg',
      approvalNumbers: ['国药准字H20138002'],
    })
    const bad = snapshot({ masters: [ALI, AML, OTHER, collide] })
    expect(() => buildSplitPlan(bad, manifest)).toThrow(SplitPlanError)
    try {
      buildSplitPlan(bad, manifest)
    } catch (err) {
      expect((err as SplitPlanError).issues.join('\n')).toContain('指纹撞车')
    }
  })

  it('源行规格/批号漂移 → 拒绝执行', () => {
    const drifted = { ...ALI, specification: '80mg' }
    const bad = snapshot({ masters: [drifted, AML, OTHER] })
    try {
      buildSplitPlan(bad, manifest)
      expect.unreachable('应当抛错')
    } catch (err) {
      expect(err).toBeInstanceOf(SplitPlanError)
      expect((err as SplitPlanError).issues.join('\n')).toContain('规格已漂移')
    }
  })

  it('用户药品规格同时匹配多个拆分行 → 拒绝执行', () => {
    const bad = snapshot({
      userDrugs: [{ id: 'drug-user-2', drugMasterId: ALI.id, specification: '80mg/240mg' }],
    })
    expect(() => buildSplitPlan(bad, manifest)).toThrow(SplitPlanError)
  })

  it('库里多出其它标记行 → 只提示，不阻断迁移', () => {
    const extra = master({
      id: 'drug-extra-1mg',
      genericName: '额外药片',
      specification: '1mg，2mg',
      approvalNumbers: ['国药准字H20100001', '国药准字H20100002'],
      manufacturer: '某厂',
    })
    const plan = buildSplitPlan(snapshot({ masters: [ALI, AML, OTHER, extra] }), manifest)
    expect(plan.warnings.join('\n')).toContain('迁移前标记数 3')
    expect(plan.stats.flaggedAfter).toBe(1)
  })

  it('迁移后内存快照通过校验；迁移前不通过', () => {
    const before = snapshot()
    expect(verifyMigration(before, manifest).length).toBeGreaterThan(0)

    const plan = buildSplitPlan(before, manifest)
    const after = applyPlan(before, plan)
    expect(verifyMigration(after, manifest)).toEqual([])
  })

  it('收窄后主批号不对 → 校验报错', () => {
    const plan = buildSplitPlan(snapshot(), manifest)
    const after = applyPlan(snapshot(), plan)
    const broken = {
      ...after,
      masters: after.masters.map((m) => (m.id === AML.id ? { ...m, approvalNumber: '国药准字H10950225' } : m)),
    }
    expect(verifyMigration(broken, manifest).join('\n')).toContain('主批号')
  })
})

describe('实盘 manifest（2026-11-20）', () => {
  const real = JSON.parse(
    readFileSync(fileURLToPath(new URL('../db/manifests/split-multi-spec-2026-11-20.json', import.meta.url)), 'utf8'),
  ) as SplitManifest

  it('结构完整：23 拆 / 60 目标 / 22 收窄，id 唯一且 update 必须沿用原 id', () => {
    expect(real.splits).toHaveLength(23)
    expect(real.splits.reduce((n, s) => n + s.targets.length, 0)).toBe(60)
    expect(real.narrows).toHaveLength(22)

    const ids = real.splits.flatMap((s) => s.targets.map((t) => t.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of real.splits) {
      const updates = entry.targets.filter((t) => t.action === 'update')
      expect(updates).toHaveLength(1)
      expect(updates[0].id).toBe(entry.sourceId)
    }
  })

  it('每个目标的主批号都在批号数组里，且迁移前后标记数写死为 147 → 102', () => {
    for (const entry of real.splits) {
      for (const target of entry.targets) {
        expect(target.approvalNumbers).toContain(target.approvalNumber)
      }
    }
    for (const entry of real.narrows) {
      expect(entry.approvalNumbers).toContain(entry.approvalNumber)
    }
    expect(real.expectedFlaggedBefore).toBe(147)
    expect(real.expectedFlaggedAfter).toBe(102)
  })
})
