/**
 * 说明书内容修复 · 规划器（M7-T5，2026-11-15）。
 *
 * 纯函数：输入「重提取后的 staging 草稿 + 库内现状快照」，输出可执行计划与校验错误，
 * 不碰数据库、不读文件，便于单测（见 __tests__/manual-repair.test.ts）。
 * 落库执行见 scripts/repair-manuals.ts。
 *
 * 背景：M6 关账带三条提取缺陷（表格被文本层拉平 / 批准文号未按规格归属 / 商品名标签变体），
 * M7 重提取后要原地刷新说明书行。规则：
 * - 按（drugId, sourceFile）定位说明书行；sourceDocumentId 由 PDF 文件哈希决定，内容重提取不换行 id；
 * - reviewed 行**不降级不删除**，内容变化走 manual_review_log action='correct'（带 diff 与事由）；
 * - 产品行同步 brand_name / approval_number(s) / specification / identity_key，身份指纹撞车整批拒绝；
 * - 字符完整性校验：重提取只允许重排、不允许丢字（Markdown 分隔符与空白不计）。
 */
import { isDeepStrictEqual } from 'node:util'
import { makeIdentityKey, fallbackContentHash } from '../../db/identity.js'
import {
  MAPPED_COLUMNS,
  mapDraftToInsertValues,
  type Draft,
  type MappedColumn,
  type MappedInsertValues,
} from '../../db/manual-draft.js'

// ---------------------------------------------------------------------------
// 现状快照
// ---------------------------------------------------------------------------
export interface InsertLite {
  id: string
  drugId: string
  sourceFile: string | null
  sourceDocumentId: string | null
  version: string | null
  curationStatus: string
  specification: string | null
  brandName: string | null
  approvalNumbers: string[] | null
  sourceSections: Record<string, string> | null
  /** 其余映射列（curationNote / genericName / 内容列…）：线上传整行，单测可缺省 */
  [column: string]: unknown
}

export interface MasterLite {
  id: string
  identityKey: string | null
  curationStatus: string
  brandName: string | null
  specification: string
  approvalNumber: string | null
  approvalNumbers: string[] | null
}

export interface RepairContext {
  /** `${drugId}|${sourceFile}` → 说明书行 */
  insertsByKey: Map<string, InsertLite>
  insertsById: Map<string, InsertLite>
  masters: Map<string, MasterLite>
  /** 用户药箱与相互作用规则对产品行的引用（删除保护） */
  userRefs: Map<string, number>
  ruleRefs: Map<string, number>
}

// ---------------------------------------------------------------------------
// 计划
// ---------------------------------------------------------------------------
export interface SectionChange {
  beforeLen: number
  afterLen: number
  hasTable: boolean
}

export interface MasterUpdate {
  masterId: string
  fields: {
    brandName?: string | null
    specification?: string
    approvalNumber?: string | null
    approvalNumbers?: string[]
    identityKey?: string
  }
  changed: string[]
}

export interface ContentUpdate {
  insertId: string
  drugId: string
  sourceFile: string
  reviewed: boolean
  changedFields: MappedColumn[]
  changedSections: Record<string, SectionChange>
  values: MappedInsertValues
  identityKey: string
}

export interface DeleteStep {
  insertId: string
  drugId: string
  sourceFile: string | null
  reviewed: boolean
  reason: string
}

export interface RepairPlan {
  updates: ContentUpdate[]
  masterUpdates: MasterUpdate[]
  deletes: DeleteStep[]
  newDrafts: Draft[]
  errors: string[]
  warnings: string[]
  counts: {
    update: number
    reviewedUpdate: number
    masterUpdate: number
    delete: number
    newDraft: number
    unchanged: number
  }
}

/** 覆盖率校验阈值：丢字超过 2% 视为重建异常（表格分隔符、空白不计入）。 */
export const CHAR_LOSS_LIMIT = 0.02
/** 多字超过 10% 视为可疑（表头重复等），只告警不阻断。 */
export const CHAR_GAIN_WARN = 0.1

// ---------------------------------------------------------------------------
// 纯工具
// ---------------------------------------------------------------------------
const MARKDOWN_SEP_RE = /^\s*\|[\s\-:|]+\|?\s*$/
const PIPE_RE = /[ \t]*\|[ \t]*/g

/** 段落正文的可见字符多重集（去掉 Markdown 分隔行、管道符与空白）。 */
export function contentCharCounts(sections: Record<string, string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const text of Object.values(sections ?? {})) {
    for (const line of String(text ?? '').split('\n')) {
      if (MARKDOWN_SEP_RE.test(line)) continue
      for (const ch of line.replace(PIPE_RE, '')) {
        if (/\s/.test(ch)) continue
        counts.set(ch, (counts.get(ch) ?? 0) + 1)
      }
    }
  }
  return counts
}

export interface Completeness {
  beforeChars: number
  afterChars: number
  lost: number
  gained: number
  lostRatio: number
  gainedRatio: number
}

export function completeness(before: Record<string, string>, after: Record<string, string>): Completeness {
  const a = contentCharCounts(before)
  const b = contentCharCounts(after)
  let beforeChars = 0
  let afterChars = 0
  let lost = 0
  let gained = 0
  for (const n of a.values()) beforeChars += n
  for (const n of b.values()) afterChars += n
  for (const [ch, n] of a) lost += Math.max(0, n - (b.get(ch) ?? 0))
  for (const [ch, n] of b) gained += Math.max(0, n - (a.get(ch) ?? 0))
  return {
    beforeChars,
    afterChars,
    lost,
    gained,
    lostRatio: beforeChars ? lost / beforeChars : 0,
    gainedRatio: beforeChars ? gained / beforeChars : 0,
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  // jsonb 会重排对象键（PostgreSQL 按 key 排序），字符串比较会把同内容误判为变化
  return isDeepStrictEqual(a ?? null, b ?? null)
}

export function draftKey(drugId: string, sourceFile: string | null | undefined): string {
  return `${drugId}|${sourceFile ?? ''}`
}

function primaryApproval(approvals: string[]): string | null {
  return approvals.find((a) => !a.includes('分包装')) ?? approvals[0] ?? null
}

function identityOf(d: Pick<Draft, 'genericName' | 'specification' | 'form' | 'manufacturer' | 'approvalNumbers'>): string {
  return makeIdentityKey({
    genericName: d.genericName,
    specification: d.specification,
    form: d.form,
    manufacturer: d.manufacturer,
    approvalNumbers: d.approvalNumbers,
  })
}

// ---------------------------------------------------------------------------
// 规划
// ---------------------------------------------------------------------------
export function planManualRepair(drafts: Draft[], ctx: RepairContext): RepairPlan {
  const errors: string[] = []
  const warnings: string[] = []
  const updates: ContentUpdate[] = []
  const masterUpdates = new Map<string, MasterUpdate>()
  const deletes: DeleteStep[] = []
  const newDrafts: Draft[] = []
  const counts = { update: 0, reviewedUpdate: 0, masterUpdate: 0, delete: 0, newDraft: 0, unchanged: 0 }

  const draftKeys = new Set<string>()
  for (const draft of drafts) draftKeys.add(draftKey(draft.drugId, draft.sourceFile))

  // 1) 逐份草稿：定位行 → 内容 diff → 产品行同步
  for (const draft of drafts) {
    const row = ctx.insertsByKey.get(draftKey(draft.drugId, draft.sourceFile))
    if (!row) {
      const sameDrug = [...ctx.insertsById.values()].filter((r) => r.drugId === draft.drugId)
      if (sameDrug.length > 0) {
        errors.push(`说明书行缺失：${draft.drugId}（${draft.sourceFile}）已有产品行 ${sameDrug.length} 条说明书，按来源文件对不上`)
      } else {
        newDrafts.push(draft)
        counts.newDraft += 1
      }
      continue
    }
    if (!row.sourceDocumentId) {
      errors.push(`说明书行缺 sourceDocumentId：${row.id}`)
      continue
    }

    const contentHash = draft.contentHash ?? fallbackContentHash(draft.sections)
    const values = mapDraftToInsertValues(draft, row.sourceDocumentId, contentHash)
    const rowRecord = row as unknown as Record<string, unknown>
    // 只比较库内行实际带有的列（单测夹具是 lite 行；线上是整行）
    const changedFields = MAPPED_COLUMNS.filter(
      (key) => key in rowRecord && !jsonEqual(values[key as MappedColumn], rowRecord[key]),
    )

    // 字符完整性：整份说明书所有段落的多重集对比（只允许重排）
    const comp = completeness(row.sourceSections ?? {}, draft.sections)
    if (comp.lostRatio > CHAR_LOSS_LIMIT) {
      errors.push(`丢字超阈值：${row.id} 丢失 ${comp.lost}/${comp.beforeChars} 字（${(comp.lostRatio * 100).toFixed(2)}%）`)
    } else if (comp.gainedRatio > CHAR_GAIN_WARN) {
      warnings.push(`多字偏多：${row.id} 多出 ${comp.gained} 字（${(comp.gainedRatio * 100).toFixed(2)}%），请人工确认表格是否重复`)
    }

    const identityKey = identityOf(draft)
    const master = ctx.masters.get(row.drugId)
    if (!master) {
      errors.push(`产品行缺失：${row.drugId}（说明书行 ${row.id}）`)
    } else {
      const fields: MasterUpdate['fields'] = {}
      const changed: string[] = []
      if ((master.brandName ?? null) !== (draft.brandName ?? null)) {
        fields.brandName = draft.brandName ?? null
        changed.push('brandName')
      }
      if (master.specification !== draft.specification) {
        fields.specification = draft.specification
        changed.push('specification')
      }
      const nextPrimary = primaryApproval(draft.approvalNumbers)
      if ((master.approvalNumber ?? null) !== nextPrimary) {
        fields.approvalNumber = nextPrimary
        changed.push('approvalNumber')
      }
      if (!jsonEqual(master.approvalNumbers ?? [], draft.approvalNumbers)) {
        fields.approvalNumbers = draft.approvalNumbers
        changed.push('approvalNumbers')
      }
      if ((master.identityKey ?? null) !== identityKey) {
        fields.identityKey = identityKey
        changed.push('identityKey')
      }
      if (changed.length > 0) {
        const existing = masterUpdates.get(row.drugId)
        if (existing) {
          // 同一产品行被多份草稿引用（一个 PDF 多规格共用 drug_master 只应有一条；出现即异常）
          errors.push(`产品行 ${row.drugId} 被多份草稿改到不同字段：${[...existing.changed, ...changed].join(',')}`)
        } else {
          masterUpdates.set(row.drugId, { masterId: row.drugId, fields, changed })
          counts.masterUpdate += 1
        }
      }
    }

    if (changedFields.length === 0) {
      counts.unchanged += 1
      continue
    }

    const changedSections: Record<string, SectionChange> = {}
    const beforeSections = row.sourceSections ?? {}
    for (const name of new Set([...Object.keys(beforeSections), ...Object.keys(draft.sections)])) {
      const before = beforeSections[name] ?? ''
      const after = draft.sections[name] ?? ''
      if (before === after) continue
      changedSections[name] = {
        beforeLen: before.length,
        afterLen: after.length,
        hasTable: after.startsWith('|') || after.includes('\n|'),
      }
    }
    const reviewed = row.curationStatus === 'reviewed'
    updates.push({
      insertId: row.id,
      drugId: row.drugId,
      sourceFile: draft.sourceFile,
      reviewed,
      changedFields,
      changedSections,
      values,
      identityKey,
    })
    counts.update += 1
    if (reviewed) counts.reviewedUpdate += 1
  }

  // 2) 旧行消失：有说明书行、但没有对应新草稿 → 删除（reviewed 拒绝，交给人工）
  for (const row of ctx.insertsById.values()) {
    if (!row.sourceFile) continue // 丁香园来源不在 M7 范围
    if (draftKeys.has(draftKey(row.drugId, row.sourceFile))) continue
    if (row.curationStatus === 'reviewed') {
      errors.push(`重提取后缺少对应草稿，但该行是 reviewed，拒绝删除：${row.id}（${row.sourceFile}）`)
      continue
    }
    deletes.push({
      insertId: row.id,
      drugId: row.drugId,
      sourceFile: row.sourceFile,
      reviewed: false,
      reason: 'M7 重提取后该来源文件不再产出此行（规格合并/解析变化）',
    })
    counts.delete += 1
  }

  // 3) 身份指纹唯一性：只看最终态（更新后的值 + 未动的值）
  const finalIdentity = new Map<string, string>()
  const identityOwner = new Map<string, string>()
  for (const master of ctx.masters.values()) {
    const next = masterUpdates.get(master.id)?.fields.identityKey ?? master.identityKey
    finalIdentity.set(master.id, next ?? '')
  }
  const deletedMasters = new Set(deletes.map((d) => d.drugId))
  for (const [masterId, identity] of finalIdentity) {
    if (!identity || deletedMasters.has(masterId)) continue
    const owner = identityOwner.get(identity)
    if (owner && owner !== masterId) {
      errors.push(`身份指纹撞车：${masterId} 与 ${owner} 将拥有同一身份（${identity.slice(0, 8)}…）`)
    } else {
      identityOwner.set(identity, masterId)
    }
  }

  // 4) 删除行后产品行清理：仅当该产品行已无任何说明书行引用
  for (const step of deletes) {
    const stillUsed = [...ctx.insertsById.values()].some(
      (r) => r.drugId === step.drugId && r.id !== step.insertId && !deletes.some((d) => d.insertId === r.id),
    )
    if (stillUsed) continue
    const ruleRefs = ctx.ruleRefs.get(step.drugId) ?? 0
    const userRefs = ctx.userRefs.get(step.drugId) ?? 0
    if (ruleRefs > 0 || userRefs > 0) {
      warnings.push(`产品行 ${step.drugId} 仍被引用（规则 ${ruleRefs} / 药箱 ${userRefs}），保留不删`)
    }
  }

  return {
    updates,
    masterUpdates: [...masterUpdates.values()],
    deletes,
    newDrafts,
    errors,
    warnings,
    counts,
  }
}
