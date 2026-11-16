/**
 * M8-T3 · DXY 15 行回填规划器（纯函数）。
 *
 * 背景：丁香园来源的 15 行入库时只映射了字段列，`source_sections` 为空、`content_hash` 为 NULL，
 * 导致 `db:review-export` 无法导出（它要求 sourceFile 非空且 sourceSections 非空）、且无法做
 * 「映射列 ↔ 原文段」逐段核对。本规划器把 `data/crawled/*.json` 的 sections 原样回填，
 * 并写 content_hash（与 import 同一 fallbackContentHash），让 DXY 行走与 PDF 行同一套核对流程。
 *
 * 安全约束：
 * - 只更新 crawled 行；reviewed 行拒绝（不降级、不覆盖核对留痕）；
 * - 已有非空 source_sections 且与草稿不一致 → 报错不覆盖（人工处理）；
 * - drugId / version / sourceUrl 与草稿不一致 → 报错；
 * - 幂等：已回填且一致 → unchanged。
 */
import { fallbackContentHash } from '../../db/identity.js'

export interface DxyDraft {
  drugId: string
  version: string
  sourceUrl: string | null
  sections: Record<string, string>
}

export interface DxyInsertRow {
  id: string
  drugId: string
  source: string | null
  version: string | null
  sourceUrl: string | null
  curationStatus: string
  sourceSections: Record<string, string> | null
  contentHash: string | null
  curationNote: string | null
}

export interface DxyBackfillUpdate {
  insertId: string
  drugId: string
  sections: Record<string, string>
  contentHash: string
  curationNote: string
}

export interface DxyBackfillPlan {
  updates: DxyBackfillUpdate[]
  unchanged: string[]
  errors: string[]
  warnings: string[]
}

const NOTE_MARK = 'M8 回填 source_sections/content_hash'

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as Record<string, unknown>)
    const bk = Object.keys(b as Record<string, unknown>)
    if (ak.length !== bk.length) return false
    return ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}

function hasSections(value: Record<string, string> | null): value is Record<string, string> {
  return !!value && Object.keys(value).length > 0
}

/**
 * @param drafts 本地 DXY 草稿（按 drugId 索引）
 * @param rows   库内丁香园来源行
 */
export function planDxyBackfill(drafts: DxyDraft[], rows: DxyInsertRow[]): DxyBackfillPlan {
  const plan: DxyBackfillPlan = { updates: [], unchanged: [], errors: [], warnings: [] }
  const draftByDrugId = new Map(drafts.map((d) => [d.drugId, d]))

  for (const row of rows) {
    if (!(row.source ?? '').includes('丁香园')) {
      plan.errors.push(`${row.drugId}：不是丁香园来源行，拒绝回填（${row.source ?? 'source 为空'}）`)
      continue
    }
    if (row.curationStatus === 'reviewed') {
      plan.errors.push(`${row.drugId}：已 reviewed，拒绝回填（不覆盖核对留痕）`)
      continue
    }
    if (row.curationStatus !== 'crawled') {
      plan.errors.push(`${row.drugId}：状态 ${row.curationStatus}，只有 crawled 可回填`)
      continue
    }
    const draft = draftByDrugId.get(row.drugId)
    if (!draft) {
      plan.errors.push(`${row.drugId}：data/crawled 中找不到对应草稿`)
      continue
    }
    if (Object.keys(draft.sections ?? {}).length === 0) {
      plan.errors.push(`${row.drugId}：草稿 sections 为空`)
      continue
    }
    if (row.version && draft.version && row.version !== draft.version) {
      plan.errors.push(`${row.drugId}：version 不一致（库 ${row.version} / 草稿 ${draft.version}）`)
      continue
    }
    if (row.sourceUrl && draft.sourceUrl && row.sourceUrl !== draft.sourceUrl) {
      plan.errors.push(`${row.drugId}：sourceUrl 不一致（库 ${row.sourceUrl} / 草稿 ${draft.sourceUrl}）`)
      continue
    }

    const contentHash = fallbackContentHash(draft.sections)
    const noteBase = (row.curationNote ?? '').trim()
    const curationNote = noteBase.includes(NOTE_MARK)
      ? noteBase
      : [noteBase, `${NOTE_MARK}（来源：data/crawled/${row.drugId}.json）`].filter(Boolean).join('；')

    const sectionsAlready = hasSections(row.sourceSections)
    if (sectionsAlready && !deepEqual(row.sourceSections, draft.sections)) {
      plan.errors.push(`${row.drugId}：库内 source_sections 非空且与草稿不一致，拒绝覆盖（需人工核对）`)
      continue
    }
    if (sectionsAlready && row.contentHash === contentHash) {
      plan.unchanged.push(row.drugId)
      continue
    }
    if (row.contentHash && !sectionsAlready) {
      plan.warnings.push(`${row.drugId}：contentHash 已存在但 source_sections 为空，将按草稿回填`)
    }

    plan.updates.push({ insertId: row.id, drugId: row.drugId, sections: draft.sections, contentHash, curationNote })
  }

  return plan
}
