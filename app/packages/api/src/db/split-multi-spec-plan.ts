/**
 * 多规格拆行迁移 · 纯规划层（2026-11-20）
 *
 * 输入：drug_master / package_inserts / drugs / interaction_rules 的快照 + manifest
 * 输出：可执行的 update / insert 补丁（不动数据库，便于 dry-run 与单测）
 *
 * 背景见 docs/specs/26-身份卡批准文号口径.md 与 data/split-dryrun-2026-11-20/：
 * 「一行 = 一个规格」是身份匹配的前提；阿利沙坦酯片 80mg/240mg 被抽成一行，
 * approval_number 只取第一个，导致 240mg 药盒配到 80mg 的批号。
 *
 * 迁移规则：
 * - 拆行：原 id 保留给第一个规格（除非它正被用户档案引用且规格指向另一个规格），
 *   其余规格新增 `{原id}-split-{strength}`；
 * - 原 id 被 drugs.drug_master_id 引用时，按 drugs.specification 的强度重新指向对应规格；
 * - interaction_rules.drugIds / drugGroups 里出现原 id 的，扩成全部规格 id（同成分同相互作用）；
 * - package_inserts 跟随拆行：原说明书更新为第一个规格，其余规格复制一份；
 * - 指纹 identityKey 按新规格/批号重算，并做撞车预检。
 */
import { makeIdentityKey } from './identity.js'
import {
  hasStrength,
  hasMultiStrengthSpec,
  parseStrengthTokens,
  strengthOverlap,
} from '../services/identity/normalize.js'

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

export interface SplitTarget {
  id: string
  action: 'update' | 'insert'
  specification: string
  approvalNumber: string
  approvalNumbers: string[]
}

export interface SplitEntry {
  sourceId: string
  expect: { specification: string; approvalNumbers: string[] }
  targets: SplitTarget[]
}

export interface NarrowEntry {
  id: string
  expect: { approvalNumbers: string[] }
  approvalNumber: string
  approvalNumbers: string[]
}

export interface SplitManifest {
  version: number
  date: string
  note?: string
  expectedFlaggedBefore?: number
  expectedFlaggedAfter?: number
  splits: SplitEntry[]
  narrows: NarrowEntry[]
}

// ---------------------------------------------------------------------------
// 快照（只取迁移需要的列）
// ---------------------------------------------------------------------------

export interface MasterRow {
  id: string
  genericName: string
  brandName: string | null
  specification: string
  form: string
  manufacturer: string | null
  approvalNumber: string | null
  approvalNumbers: string[] | null
  identityKey: string | null
  note: string | null
}

export interface InsertRow {
  id: string
  drugId: string
  specification: string | null
  approvalNumbers: string[] | null
  curationNote: string | null
}

export interface UserDrugRow {
  id: string
  drugMasterId: string | null
  specification: string | null
}

export interface RuleRow {
  id: string
  drugIds: string[]
  drugGroups: string[][] | null
}

export interface Snapshot {
  masters: MasterRow[]
  inserts: InsertRow[]
  userDrugs: UserDrugRow[]
  rules: RuleRow[]
}

// ---------------------------------------------------------------------------
// 补丁
// ---------------------------------------------------------------------------

export interface MasterPatch {
  id: string
  specification: string
  approvalNumber: string
  approvalNumbers: string[]
  identityKey: string
  note: string
}

export interface MasterInsert extends MasterPatch {
  sourceId: string
}

export interface InsertPatch {
  id: string
  drugId: string
  specification: string
  approvalNumbers: string[]
  note: string
}

export interface InsertClone {
  sourceInsertId: string
  newDrugId: string
  specification: string
  approvalNumbers: string[]
  note: string
}

export interface UserDrugPatch {
  id: string
  from: string
  to: string
}

export interface RulePatch {
  id: string
  drugIds: string[]
  drugGroups: string[][] | null
}

export interface PlanStats {
  splits: number
  targets: number
  narrows: number
  flaggedBefore: number
  flaggedAfter: number
}

export interface SplitPlan {
  masterUpdates: MasterPatch[]
  masterInserts: MasterInsert[]
  insertUpdates: InsertPatch[]
  insertClones: InsertClone[]
  userDrugUpdates: UserDrugPatch[]
  ruleUpdates: RulePatch[]
  warnings: string[]
  stats: PlanStats
}

export class SplitPlanError extends Error {
  constructor(public readonly issues: string[]) {
    super(`拆行预检失败（${issues.length} 项）`)
    this.name = 'SplitPlanError'
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

export const isFlaggedMaster = (row: Pick<MasterRow, 'specification' | 'approvalNumbers'>): boolean =>
  (row.approvalNumbers?.length ?? 0) > 1 || hasMultiStrengthSpec(row.specification)

const sameNumberSet = (a: string[] | null | undefined, b: string[] | null | undefined): boolean => {
  const left = [...new Set((a ?? []).map((x) => x.trim()).filter(Boolean))].sort()
  const right = [...new Set((b ?? []).map((x) => x.trim()).filter(Boolean))].sort()
  return left.length === right.length && left.every((x, i) => x === right[i])
}

const appendNote = (base: string | null, extra: string): string =>
  base?.trim() ? `${base.trim()}；${extra}` : extra

const uniq = <T>(list: T[]): T[] => [...new Set(list)]

// ---------------------------------------------------------------------------
// 规划
// ---------------------------------------------------------------------------

export function buildSplitPlan(snapshot: Snapshot, manifest: SplitManifest): SplitPlan {
  const issues: string[] = []
  const warnings: string[] = []

  const masterById = new Map(snapshot.masters.map((m) => [m.id, m]))
  const insertByDrug = new Map<string, InsertRow[]>()
  for (const ins of snapshot.inserts) {
    insertByDrug.set(ins.drugId, [...(insertByDrug.get(ins.drugId) ?? []), ins])
  }
  const userByMaster = new Map<string, UserDrugRow[]>()
  for (const drug of snapshot.userDrugs) {
    if (!drug.drugMasterId) continue
    userByMaster.set(drug.drugMasterId, [...(userByMaster.get(drug.drugMasterId) ?? []), drug])
  }

  if (manifest.version !== 1) issues.push(`manifest.version=${manifest.version}，只支持 1`)

  // 1) 源行存在性与快照一致性
  for (const entry of manifest.splits) {
    const src = masterById.get(entry.sourceId)
    if (!src) {
      issues.push(`拆行源不存在：${entry.sourceId}`)
      continue
    }
    if (src.specification !== entry.expect.specification) {
      issues.push(`源行规格已漂移：${entry.sourceId} 库「${src.specification}」≠ manifest「${entry.expect.specification}」`)
    }
    if (!sameNumberSet(src.approvalNumbers, entry.expect.approvalNumbers)) {
      issues.push(`源行批号已漂移：${entry.sourceId} 库「${(src.approvalNumbers ?? []).join('、')}」≠ manifest「${entry.expect.approvalNumbers.join('、')}」`)
    }
    if (!entry.targets.some((t) => t.action === 'update' && t.id === entry.sourceId)) {
      issues.push(`拆行缺少 update 目标（原 id 必须保留给第一个规格）：${entry.sourceId}`)
    }
  }
  for (const entry of manifest.narrows) {
    const src = masterById.get(entry.id)
    if (!src) {
      issues.push(`收窄源不存在：${entry.id}`)
      continue
    }
    if (!sameNumberSet(src.approvalNumbers, entry.expect.approvalNumbers)) {
      issues.push(`收窄源批号已漂移：${entry.id} 库「${(src.approvalNumbers ?? []).join('、')}」≠ manifest「${entry.expect.approvalNumbers.join('、')}」`)
    }
  }

  if (issues.length) throw new SplitPlanError(issues)

  const existingIds = new Set(snapshot.masters.map((m) => m.id))
  const keyOwner = new Map<string, string>()
  for (const m of snapshot.masters) {
    if (m.identityKey) keyOwner.set(m.identityKey, m.id)
  }

  // 被拆 / 被收窄的原行，其旧指纹会释放
  const touchedIds = new Set<string>([
    ...manifest.splits.map((s) => s.sourceId),
    ...manifest.narrows.map((n) => n.id),
  ])
  for (const id of touchedIds) {
    const key = masterById.get(id)?.identityKey
    if (key && keyOwner.get(key) === id) keyOwner.delete(key)
  }

  const claimKey = (key: string, id: string, where: string): void => {
    const owner = keyOwner.get(key)
    if (owner && owner !== id) {
      issues.push(`${where} 指纹撞车：${key.slice(0, 12)}… 已被 ${owner} 占用`)
    }
    keyOwner.set(key, id)
  }

  const masterUpdates: MasterPatch[] = []
  const masterInserts: MasterInsert[] = []
  const insertUpdates: InsertPatch[] = []
  const insertClones: InsertClone[] = []
  const userDrugUpdates: UserDrugPatch[] = []
  const ruleUpdates: RulePatch[] = []
  const patchedSpec = new Map<string, string>()
  const patchedNumbers = new Map<string, string[]>()

  // 2) 拆行
  for (const entry of manifest.splits) {
    const src = masterById.get(entry.sourceId)!
    const updateTarget = entry.targets.find((t) => t.action === 'update')!
    const insertTargets = entry.targets.filter((t) => t.action === 'insert')
    const allTargets = [updateTarget, ...insertTargets]
    const seenTargetIds = new Set<string>()

    for (const target of allTargets) {
      if (seenTargetIds.has(target.id)) issues.push(`manifest 内目标 id 重复：${target.id}`)
      seenTargetIds.add(target.id)
      if (target.action === 'insert' && existingIds.has(target.id)) {
        issues.push(`新增 id 已存在：${target.id}`)
      }
      if (target.action === 'update' && target.id !== entry.sourceId) {
        issues.push(`update 目标必须是原 id：${target.id} ≠ ${entry.sourceId}`)
      }
      if (!target.approvalNumbers.length) issues.push(`目标无批号：${target.id}`)
      const key = makeIdentityKey({
        genericName: src.genericName,
        specification: target.specification,
        form: src.form,
        manufacturer: src.manufacturer,
        approvalNumbers: target.approvalNumbers,
      })
      claimKey(key, target.id, `拆行 ${target.id}`)
      const patch: MasterPatch = {
        id: target.id,
        specification: target.specification,
        approvalNumber: target.approvalNumber,
        approvalNumbers: target.approvalNumbers,
        identityKey: key,
        note: appendNote(
          src.note,
          `2026-11-20 多规格拆行：原「${entry.expect.specification}」拆出「${target.specification}」，批号 ${target.approvalNumbers.join('、')}`,
        ),
      }
      if (target.action === 'update') {
        masterUpdates.push(patch)
        patchedSpec.set(target.id, target.specification)
        patchedNumbers.set(target.id, target.approvalNumbers)
      } else {
        masterInserts.push({ ...patch, sourceId: entry.sourceId })
        existingIds.add(target.id)
        patchedSpec.set(target.id, target.specification)
        patchedNumbers.set(target.id, target.approvalNumbers)
      }
    }

    // 2b) 用户档案按规格改指向（原 id 只保留给 update 目标）
    for (const drug of userByMaster.get(entry.sourceId) ?? []) {
      const tokens = parseStrengthTokens(drug.specification ?? '')
      if (!hasStrength(tokens)) {
        warnings.push(`用户药品 ${drug.id} 规格为空/无法解析，保留原 id ${entry.sourceId}（现为「${updateTarget.specification}」）`)
        continue
      }
      const matches = allTargets.filter((t) =>
        strengthOverlap(parseStrengthTokens(t.specification), tokens),
      )
      if (matches.length === 0) {
        warnings.push(`用户药品 ${drug.id}（规格「${drug.specification}」）未匹配任何拆分行，保留原 id ${entry.sourceId}`)
      } else if (matches.length > 1) {
        issues.push(`用户药品 ${drug.id} 规格「${drug.specification}」同时匹配多个拆分行：${matches.map((m) => m.id).join('、')}`)
      } else if (matches[0].id !== entry.sourceId) {
        userDrugUpdates.push({ id: drug.id, from: entry.sourceId, to: matches[0].id })
      }
    }

    // 2c) 说明书跟随拆行：原 insert 改为第一个规格，其余规格复制
    const srcInserts = insertByDrug.get(entry.sourceId) ?? []
    if (srcInserts.length === 0) {
      warnings.push(`源行无 package_inserts：${entry.sourceId}（拆出的规格将没有说明书）`)
    }
    for (const ins of srcInserts) {
      insertUpdates.push({
        id: ins.id,
        drugId: entry.sourceId,
        specification: updateTarget.specification,
        approvalNumbers: updateTarget.approvalNumbers,
        note: appendNote(ins.curationNote, `2026-11-20 多规格拆行：本说明书改挂「${updateTarget.specification}」`),
      })
      for (const target of insertTargets) {
        insertClones.push({
          sourceInsertId: ins.id,
          newDrugId: target.id,
          specification: target.specification,
          approvalNumbers: target.approvalNumbers,
          note: appendNote(ins.curationNote, `2026-11-20 多规格拆行：由 ${entry.sourceId} 复制，仅覆盖「${target.specification}」`),
        })
      }
    }
  }

  // 3) 单规格行批号收窄
  for (const entry of manifest.narrows) {
    const src = masterById.get(entry.id)!
    const key = makeIdentityKey({
      genericName: src.genericName,
      specification: src.specification,
      form: src.form,
      manufacturer: src.manufacturer,
      approvalNumbers: entry.approvalNumbers,
    })
    claimKey(key, entry.id, `收窄 ${entry.id}`)
    masterUpdates.push({
      id: entry.id,
      specification: src.specification,
      approvalNumber: entry.approvalNumber,
      approvalNumbers: entry.approvalNumbers,
      identityKey: key,
      note: appendNote(
        src.note,
        `2026-11-20 批号收窄：原 ${(src.approvalNumbers ?? []).join('、')} → ${entry.approvalNumbers.join('、')}`,
      ),
    })
    patchedNumbers.set(entry.id, entry.approvalNumbers)
    const inserts = insertByDrug.get(entry.id) ?? []
    if (inserts.length === 0) warnings.push(`收窄行无 package_inserts：${entry.id}`)
    for (const ins of inserts) {
      insertUpdates.push({
        id: ins.id,
        drugId: entry.id,
        specification: src.specification,
        approvalNumbers: entry.approvalNumbers,
        note: appendNote(ins.curationNote, `2026-11-20 批号收窄：${entry.approvalNumbers.join('、')}`),
      })
    }
  }

  // 4) 相互作用规则：原 id 扩成全部规格 id（同成分同相互作用，避免 240mg 用户漏检）
  const splitBySource = new Map(manifest.splits.map((s) => [s.sourceId, s]))
  for (const rule of snapshot.rules) {
    const targetsOf = (id: string): string[] => {
      const entry = splitBySource.get(id)
      return entry ? entry.targets.map((t) => t.id) : [id]
    }
    const hasSource = rule.drugIds.some((id) => splitBySource.has(id))
      || (rule.drugGroups ?? []).some((g) => g.some((id) => splitBySource.has(id)))
    if (!hasSource) continue

    const drugIds = uniq(rule.drugIds.flatMap(targetsOf))
    const drugGroups = rule.drugGroups
      ? rule.drugGroups.map((group) => uniq(group.flatMap(targetsOf)))
      : null
    ruleUpdates.push({ id: rule.id, drugIds, drugGroups })
  }

  // 5) 迁移后标记数（应等于 manifest 期望）
  const afterRows: Array<Pick<MasterRow, 'specification' | 'approvalNumbers'>> = snapshot.masters
    .filter((m) => !touchedIds.has(m.id))
    .map((m) => ({ specification: m.specification, approvalNumbers: m.approvalNumbers }))
  for (const [id, spec] of patchedSpec) afterRows.push({ specification: spec, approvalNumbers: patchedNumbers.get(id) ?? [] })
  for (const [id, numbers] of patchedNumbers) {
    if (!patchedSpec.has(id)) {
      const src = masterById.get(id)
      if (src) afterRows.push({ specification: src.specification, approvalNumbers: numbers })
    }
  }
  const flaggedAfter = afterRows.filter(isFlaggedMaster).length
  const flaggedBefore = snapshot.masters.filter(isFlaggedMaster).length

  if (manifest.expectedFlaggedBefore !== undefined && flaggedBefore !== manifest.expectedFlaggedBefore) {
    warnings.push(`迁移前标记数 ${flaggedBefore} ≠ manifest ${manifest.expectedFlaggedBefore}（库与 1589 份草稿影子有差异，按实际库继续）`)
  }
  if (manifest.expectedFlaggedAfter !== undefined && flaggedAfter !== manifest.expectedFlaggedAfter) {
    warnings.push(`迁移后标记数预计 ${flaggedAfter} ≠ manifest ${manifest.expectedFlaggedAfter}（同上，按实际库继续）`)
  }

  if (issues.length) throw new SplitPlanError(issues)

  return {
    masterUpdates,
    masterInserts,
    insertUpdates,
    insertClones,
    userDrugUpdates,
    ruleUpdates,
    warnings,
    stats: {
      splits: manifest.splits.length,
      targets: manifest.splits.reduce((n, s) => n + s.targets.length, 0),
      narrows: manifest.narrows.length,
      flaggedBefore,
      flaggedAfter,
    },
  }
}

// ---------------------------------------------------------------------------
// 迁移后校验（只读）
// ---------------------------------------------------------------------------

export function verifyMigration(snapshot: Snapshot, manifest: SplitManifest): string[] {
  const issues: string[] = []
  const masters = new Map(snapshot.masters.map((m) => [m.id, m]))
  const insertDrugIds = new Set(snapshot.inserts.map((i) => i.drugId))
  const seenKeys = new Map<string, string>()

  for (const m of snapshot.masters) {
    if (m.identityKey) {
      const prev = seenKeys.get(m.identityKey)
      if (prev) issues.push(`指纹重复：${m.identityKey.slice(0, 12)}… ${prev} / ${m.id}`)
      else seenKeys.set(m.identityKey, m.id)
    }
  }

  for (const entry of manifest.splits) {
    for (const target of entry.targets) {
      const row = masters.get(target.id)
      if (!row) {
        issues.push(`拆行目标缺失：${target.id}`)
        continue
      }
      if (row.specification !== target.specification) {
        issues.push(`${target.id} 规格「${row.specification}」≠ 目标「${target.specification}」`)
      }
      if (!sameNumberSet(row.approvalNumbers, target.approvalNumbers)) {
        issues.push(`${target.id} 批号「${(row.approvalNumbers ?? []).join('、')}」≠ 目标「${target.approvalNumbers.join('、')}」`)
      }
      if (isFlaggedMaster(row)) issues.push(`${target.id} 仍被判为多规格/多批号`)
      if (!insertDrugIds.has(target.id)) issues.push(`${target.id} 缺少 package_inserts`)
    }
  }

  for (const entry of manifest.narrows) {
    const row = masters.get(entry.id)
    if (!row) {
      issues.push(`收窄目标缺失：${entry.id}`)
      continue
    }
    if (!sameNumberSet(row.approvalNumbers, entry.approvalNumbers)) {
      issues.push(`${entry.id} 收窄后批号「${(row.approvalNumbers ?? []).join('、')}」≠ 目标「${entry.approvalNumbers.join('、')}」`)
    }
    if ((row.approvalNumber ?? '') !== entry.approvalNumber) {
      issues.push(`${entry.id} 主批号「${row.approvalNumber ?? ''}」≠ 目标「${entry.approvalNumber}」`)
    }
  }

  // 用户档案：规格指向非首规格的，必须已改挂到对应拆分行
  for (const entry of manifest.splits) {
    for (const drug of snapshot.userDrugs) {
      if (drug.drugMasterId !== entry.sourceId) continue
      const tokens = parseStrengthTokens(drug.specification ?? '')
      if (!hasStrength(tokens)) continue
      const matches = entry.targets.filter((t) =>
        strengthOverlap(parseStrengthTokens(t.specification), tokens),
      )
      if (matches.length === 1 && matches[0].id !== entry.sourceId) {
        issues.push(`用户药品 ${drug.id}（规格「${drug.specification}」）仍指向 ${entry.sourceId}，应改挂 ${matches[0].id}`)
      }
    }
  }

  const masterIds = new Set(snapshot.masters.map((m) => m.id))
  for (const drug of snapshot.userDrugs) {
    if (drug.drugMasterId && !masterIds.has(drug.drugMasterId)) {
      issues.push(`用户药品 ${drug.id} 引用不存在的 drug_master：${drug.drugMasterId}`)
    }
  }

  return issues
}
