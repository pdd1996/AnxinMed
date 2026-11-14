/**
 * 说明书规格修复 · 规划器（M6-T9-fix，2026-11-14）。
 *
 * 纯函数：输入「修复操作清单 + 库内现状快照」，输出可执行计划与校验错误，
 * 不碰数据库、不读文件，便于单测（见 __tests__/repair-specs.test.ts）。
 * 落库执行见 scripts/repair-specs.ts。
 *
 * 背景：M6 的 PDF 提取器有三处解析缺陷（编号剥离吃掉规格前导数字、括号内分隔符被当条目
 * 分隔、PDF 排版折行被当独立规格行），导致说明书库 61 行规格与源文不一致（含 5 行 reviewed）。
 * 提取器已修（tools/manual-pdf/extract.py），修复分三类操作：
 *   update-spec  同 drugId，仅规格文本（与身份指纹）更新，原地改；
 *   rename       drugId 随规格变化：迁移说明书行 + 迁移/克隆产品行 + 重指用户药箱链接；
 *   delete       合并后多余的行（源文里本就同一规格段，旧行是解析切片），行与孤儿产品一起删。
 *
 * 硬口径：
 * - reviewed 行**不降级也不删除**：修正后保留 reviewedBy/reviewedAt/reviewMeta，
 *   另写 manual_review_log action='correct'（M6-T9 缺的「reviewed 修正通道」）；
 * - 拒绝改到已被占用的 drugId；拒绝身份指纹撞车；目标说明书行 ID 冲突即报错；
 * - 产品行仍被用户药箱或相互作用规则引用时保留产品行并告警。
 */
import { z } from 'zod'
import { makeIdentityKey } from '../../db/identity.js'
import type { Draft } from '../../db/manual-draft.js'

// ---------------------------------------------------------------------------
// 操作契约（由 tools/manual-pdf 侧生成）
// ---------------------------------------------------------------------------
const BaseSchema = z.object({ pdf: z.string().min(1) })

export const RepairOpsSchema = z.object({
  schemaVersion: z.literal(1),
  pdfCount: z.number().int().positive(),
  ops: z.array(z.discriminatedUnion('op', [
    BaseSchema.extend({
      op: z.literal('update-spec'),
      fromId: z.string().min(1),
      toId: z.string().min(1),
      fromSpec: z.string(),
      toSpec: z.string(),
      reviewed: z.boolean().default(false),
    }),
    BaseSchema.extend({
      op: z.literal('rename'),
      fromId: z.string().min(1),
      toId: z.string().min(1),
      fromSpec: z.string(),
      toSpec: z.string(),
      reviewed: z.boolean().default(false),
    }),
    BaseSchema.extend({
      op: z.literal('delete'),
      drugId: z.string().min(1),
      reason: z.string(),
      reviewed: z.boolean().default(false),
    }),
  ])),
})

export type RepairOps = z.infer<typeof RepairOpsSchema>
export type RepairOp = RepairOps['ops'][number]

// ---------------------------------------------------------------------------
// 现状快照
// ---------------------------------------------------------------------------
export interface InsertLite {
  id: string
  drugId: string
  sourceFile: string | null
  version: string | null
  sourceDocumentId: string | null
  specification: string | null
  curationStatus: string
  reviewedBy: string | null
}

export interface MasterLite {
  id: string
  identityKey: string | null
  curationStatus: string
}

export interface PlanContext {
  /** `${drugId}|${sourceFile}` → 说明书行（一次修复内唯一） */
  insertsByKey: Map<string, InsertLite>
  insertsById: Map<string, InsertLite>
  masters: Map<string, MasterLite>
  drafts: Map<string, Draft>
  /** 用户药箱 drugs.drug_master_id → 引用数量 */
  userRefs: Map<string, number>
  /** interaction_rules.drug_ids 引用数（规则库条目只能抄录，不随修复删） */
  ruleRefs: Map<string, number>
}

// ---------------------------------------------------------------------------
// 计划
// ---------------------------------------------------------------------------
export type PlanStep =
  | { kind: 'delete-insert'; insertId: string; reviewed: boolean; reason: string }
  | { kind: 'delete-master'; masterId: string }
  | { kind: 'update-spec'; insertId: string; drugId: string; fromSpec: string | null; toSpec: string; reviewed: boolean }
  | {
      kind: 'rename'
      fromInsertId: string
      toInsertId: string
      fromDrugId: string
      toDrugId: string
      fromSpec: string | null
      toSpec: string
      reviewed: boolean
      /** true = 旧产品行直接改 id（没有别的行引用它）；false = 克隆新产品行 */
      moveMaster: boolean
    }

export interface RepairPlan {
  steps: PlanStep[]
  errors: string[]
  warnings: string[]
  counts: { delete: number; updateSpec: number; rename: number; moveMaster: number; cloneMaster: number }
}

export function normalizeSpec(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, '')
}

export function insertIdFor(drugId: string, version: string | null, sourceDocumentId: string): string {
  return `pi-${drugId}@${version}-${sourceDocumentId.slice(3, 11)}`
}

function draftIdentity(draft: Draft): string {
  return makeIdentityKey({
    genericName: draft.genericName,
    specification: draft.specification,
    form: draft.form,
    manufacturer: draft.manufacturer,
    approvalNumbers: draft.approvalNumbers,
  })
}

export function planRepair(ops: RepairOps, ctx: PlanContext): RepairPlan {
  const errors: string[] = []
  const warnings: string[] = []
  const steps: PlanStep[] = []
  const counts = { delete: 0, updateSpec: 0, rename: 0, moveMaster: 0, cloneMaster: 0 }

  const deletedInserts = new Set<string>()
  const deletedMasters = new Set<string>()
  const renameTargets = new Set<string>()
  const identityAfter = new Map<string, string>() // masterId → 新 identityKey
  const claimedInsertIds = new Set<string>()

  const resolveRow = (drugId: string, pdf: string): InsertLite | undefined => {
    const byKey = ctx.insertsByKey.get(`${drugId}|${pdf}`)
    if (byKey) return byKey
    // 容错：同 drugId 只有一行时按 drugId 兜底（PDF 文件名口径差异）
    const sameDrug = [...ctx.insertsById.values()].filter((r) => r.drugId === drugId)
    return sameDrug.length === 1 ? sameDrug[0] : undefined
  }

  // 1) 删除：先校验
  for (const op of ops.ops) {
    if (op.op !== 'delete') continue
    const row = resolveRow(op.drugId, op.pdf)
    if (!row) {
      errors.push(`delete 行不存在：${op.drugId}（${op.pdf}）`)
      continue
    }
    if (op.reviewed || row.curationStatus === 'reviewed') {
      errors.push(`拒绝删除 reviewed 说明书行：${row.id}`)
      continue
    }
    if (deletedInserts.has(row.id)) {
      errors.push(`重复 delete：${row.id}`)
      continue
    }
    deletedInserts.add(row.id)
    deletedMasters.add(row.drugId)
    steps.push({ kind: 'delete-insert', insertId: row.id, reviewed: false, reason: op.reason })
    counts.delete += 1
  }

  // 2) 更新 / 改名：校验 + 步骤
  for (const op of ops.ops) {
    if (op.op === 'delete') continue
    const row = resolveRow(op.fromId, op.pdf)
    if (!row) {
      errors.push(`${op.op} 行不存在：${op.fromId}（${op.pdf}）`)
      continue
    }
    if (deletedInserts.has(row.id)) {
      errors.push(`${op.op} 的源行同时被 delete：${row.id}`)
      continue
    }
    const draft = ctx.drafts.get(op.toId)
    if (!draft) {
      errors.push(`${op.op} 缺对应修正草稿：${op.toId}`)
      continue
    }
    if (normalizeSpec(draft.specification) !== normalizeSpec(op.toSpec)) {
      errors.push(`草稿规格与操作不一致：${op.toId}（草稿 ${draft.specification} ≠ 操作 ${op.toSpec}）`)
      continue
    }
    const newIdentity = draftIdentity(draft)

    const isRenamed = op.op === 'rename' && op.toId !== op.fromId
    if (isRenamed) {
      if (renameTargets.has(op.toId) || claimedInsertIds.has(op.toId)) {
        errors.push(`多个操作指向同一目标 drugId：${op.toId}`)
        continue
      }
      renameTargets.add(op.toId)
      const targetMaster = ctx.masters.get(op.toId)
      if (targetMaster && !deletedMasters.has(op.toId)) {
        errors.push(`目标 drugId 已被占用：${op.toId}（来源 ${op.fromId}）`)
        continue
      }
      if (!row.sourceDocumentId) {
        errors.push(`rename 行缺 sourceDocumentId，无法重算说明书行 ID：${op.fromId}`)
        continue
      }
      const toInsertId = insertIdFor(op.toId, row.version, row.sourceDocumentId)
      if (ctx.insertsById.has(toInsertId) && !deletedInserts.has(toInsertId)) {
        errors.push(`目标说明书行 ID 已存在：${toInsertId}`)
        continue
      }
      claimedInsertIds.add(toInsertId)

      // 旧产品行还有别的说明书行引用 → 只能克隆，不能改名
      const otherRefs = [...ctx.insertsById.values()].filter(
        (r) => r.drugId === op.fromId && r.id !== row.id && !deletedInserts.has(r.id),
      ).length
      const referenced = otherRefs > 0
      if (referenced) counts.cloneMaster += 1
      else counts.moveMaster += 1

      steps.push({
        kind: 'rename',
        fromInsertId: row.id,
        toInsertId,
        fromDrugId: op.fromId,
        toDrugId: op.toId,
        fromSpec: row.specification,
        toSpec: op.toSpec,
        reviewed: row.curationStatus === 'reviewed',
        moveMaster: !referenced,
      })
      identityAfter.set(op.toId, newIdentity)
      counts.rename += 1
    } else {
      if (op.toId !== op.fromId) {
        errors.push(`update-spec 的 toId 必须等于 fromId：${op.fromId} → ${op.toId}`)
        continue
      }
      steps.push({
        kind: 'update-spec',
        insertId: row.id,
        drugId: row.drugId,
        fromSpec: row.specification,
        toSpec: op.toSpec,
        reviewed: row.curationStatus === 'reviewed',
      })
      identityAfter.set(op.fromId, newIdentity)
      counts.updateSpec += 1
    }
  }

  // 3) 身份指纹唯一性：新身份不能与库内其他产品相同
  const identityOwner = new Map<string, string>()
  for (const m of ctx.masters.values()) {
    if (m.identityKey) identityOwner.set(m.identityKey, m.id)
  }
  for (const [masterId, identity] of identityAfter) {
    const owner = identityOwner.get(identity)
    if (owner && owner !== masterId) {
      const ownerDeleted = deletedMasters.has(owner)
      const ownerUpdatedAway = identityAfter.has(owner) && identityAfter.get(owner) !== identity
      if (!ownerDeleted && !ownerUpdatedAway) {
        errors.push(`身份指纹撞车：${masterId} 的新身份已被 ${owner} 占用`)
      }
    }
  }

  // 4) 删除后的孤儿产品行 + 引用保护
  for (const op of ops.ops) {
    if (op.op !== 'delete') continue
    const row = resolveRow(op.drugId, op.pdf)
    if (!row) continue
    if (errors.some((e) => e.includes(row.id))) continue
    // 只要还有别的说明书行引用这个产品行，就不能删产品行；
    // 若它是某个 rename 的目标，必须先删掉旧产品行，rename 才能把产品行改到该 id。
    const stillUsed = [...ctx.insertsById.values()].some(
      (r) => r.drugId === row.drugId && r.id !== row.id && !deletedInserts.has(r.id),
    )
    if (stillUsed) continue
    const userRefCount = ctx.userRefs.get(row.drugId) ?? 0
    const ruleRefCount = ctx.ruleRefs.get(row.drugId) ?? 0
    if (ruleRefCount > 0) {
      warnings.push(`产品行 ${row.drugId} 仍被相互作用规则引用，保留产品行不删`)
      continue
    }
    if (userRefCount > 0) {
      warnings.push(`产品行 ${row.drugId} 仍被 ${userRefCount} 条用户药箱引用，保留产品行不删`)
      continue
    }
    steps.push({ kind: 'delete-master', masterId: row.drugId })
  }

  const order: Record<PlanStep['kind'], number> = {
    'delete-insert': 0,
    'delete-master': 1,
    'update-spec': 2,
    rename: 3,
  }
  steps.sort((a, b) => order[a.kind] - order[b.kind])
  return { steps, errors, warnings, counts }
}
