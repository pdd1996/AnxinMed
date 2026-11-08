/**
 * 说明书人工核对 · 决策校验与应用计划（M6-T9）。
 *
 * 纯函数：输入审核页导出的 decisions 与数据库快照，输出可执行计划或错误；
 * 不碰数据库，便于单测。apply 脚本只负责事务落库。
 */
import { z } from 'zod'
import type { ReviewMeta, ReviewSectionStatus } from '../../db/schema.js'

export const REQUIRED_SECTIONS = [
  { key: 'indication', label: '适应症/功能主治', sourceKeys: ['适应症', '功能主治'] },
  { key: 'contraindication', label: '禁忌', sourceKeys: ['禁忌'] },
  { key: 'precautions', label: '注意事项', sourceKeys: ['注意事项'] },
  { key: 'adverse', label: '不良反应', sourceKeys: ['不良反应'] },
  { key: 'interactions', label: '药物相互作用', sourceKeys: ['药物相互作用'] },
  { key: 'dosage', label: '用法用量', sourceKeys: ['用法用量', '用法与用量'] },
] as const

export type RequiredSectionKey = (typeof REQUIRED_SECTIONS)[number]['key']
export const SECTION_STATUSES = ['verified', 'source-missing', 'corrected'] as const

const SectionDecisionSchema = z.object({
  status: z.enum(SECTION_STATUSES),
  text: z.string().optional(),
  reason: z.string().optional(),
})

export const ReviewDecisionItemSchema = z.object({
  insertId: z.string().min(1),
  drugId: z.string().min(1),
  contentHash: z.string().nullable(),
  action: z.enum(['promote', 'reject', 'skip']),
  identityConfirmed: z.boolean(),
  optionalConfirmed: z.boolean(),
  rejectReason: z.string().optional().default(''),
  sections: z.record(SectionDecisionSchema).default({}),
})

export const ReviewDecisionsSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.string().min(1),
  reviewer: z.string().trim().min(1),
  exportedAt: z.string().min(1),
  items: z.array(ReviewDecisionItemSchema).min(1),
})

export type ReviewDecisionItem = z.infer<typeof ReviewDecisionItemSchema>
export type ReviewDecisions = z.infer<typeof ReviewDecisionsSchema>

export interface InsertSnapshot {
  insertId: string
  drugId: string
  curationStatus: string
  contentHash: string | null
  sourceSections: Record<string, string> | null
  indication: string | null
  contraindications: unknown
  precautions: unknown
  adverseReactions: string | null
  interactions: string | null
  dosage: unknown
}

function joinText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join('\n')
  if (typeof value === 'string') return value
  return ''
}

function mappedText(snapshot: InsertSnapshot, key: RequiredSectionKey): string {
  switch (key) {
    case 'indication':
      return snapshot.indication ?? ''
    case 'contraindication':
      return joinText(snapshot.contraindications)
    case 'precautions':
      return joinText(snapshot.precautions)
    case 'adverse':
      return snapshot.adverseReactions ?? ''
    case 'interactions':
      return snapshot.interactions ?? ''
    case 'dosage': {
      const raw = snapshot.dosage
      if (raw && typeof raw === 'object' && 'raw' in raw) return String((raw as { raw: unknown }).raw ?? '')
      return ''
    }
  }
}

/** 解析某必核段：优先 sourceSections 原段，其次结构化字段（与审核页同口径）。 */
export function resolveSection(snapshot: InsertSnapshot, key: RequiredSectionKey): { text: string; sourceKey: string | null } {
  const slot = REQUIRED_SECTIONS.find((s) => s.key === key)!
  for (const sourceKey of slot.sourceKeys) {
    const text = snapshot.sourceSections?.[sourceKey]
    if (text && text.trim()) return { text, sourceKey }
  }
  return { text: mappedText(snapshot, key), sourceKey: null }
}

interface CorrectionUpdate {
  field: RequiredSectionKey
  sourceKey: string
  from: string
  to: string
  reason: string
  mapped: Record<string, unknown>
}

export interface ApplyPlan {
  insertId: string
  drugId: string
  action: ReviewDecisionItem['action']
  note: string
  errors: string[]
  corrections: CorrectionUpdate[]
  reviewMeta: ReviewMeta | null
  rejectReason: string
}

/**
 * 校验一条决策并生成应用计划。
 * - 已 reviewed：幂等跳过（note），不报错；
 * - contentHash 不一致：stale，报错；
 * - promote：身份/其余段确认 + 6 必核段全部处置；修正必须带正文与原因；
 * - source-missing 仅当解析正文为空；verified 仅当解析正文非空。
 */
export function planItem(item: ReviewDecisionItem, snapshot: InsertSnapshot): ApplyPlan {
  const errors: string[] = []
  const base: ApplyPlan = {
    insertId: item.insertId,
    drugId: item.drugId,
    action: item.action,
    note: '',
    errors,
    corrections: [],
    reviewMeta: null,
    rejectReason: item.rejectReason ?? '',
  }

  if (item.drugId !== snapshot.drugId) {
    errors.push(`drugId 不一致：decisions=${item.drugId} / DB=${snapshot.drugId}`)
    return base
  }
  if (item.contentHash !== snapshot.contentHash) {
    errors.push('contentHash 已变化（stale），请重新导出批次后再核对')
    return base
  }
  if (snapshot.curationStatus === 'reviewed') {
    base.note = '已 reviewed，跳过（幂等）'
    return base
  }
  if (snapshot.curationStatus !== 'crawled') {
    errors.push(`当前状态 ${snapshot.curationStatus}，只有 crawled 可以核对`)
    return base
  }
  if (item.action === 'skip') {
    base.note = '本批跳过'
    return base
  }
  if (item.action === 'reject') {
    if (!item.rejectReason.trim()) errors.push('退回必须写原因')
    return base
  }

  if (!item.identityConfirmed) errors.push('身份字段未确认')
  if (!item.optionalConfirmed) errors.push('其余段落未确认已扫读')

  const statuses: Record<string, ReviewSectionStatus> = {}
  for (const slot of REQUIRED_SECTIONS) {
    const decision = item.sections[slot.key]
    if (!decision || !decision.status) {
      errors.push(`必核段未处置：${slot.label}`)
      continue
    }
    const resolved = resolveSection(snapshot, slot.key)
    statuses[slot.key] = decision.status

    if (decision.status === 'verified' && !resolved.text.trim()) {
      errors.push(`「${slot.label}」正文为空，不能标「与源文一致」`)
    }
    if (decision.status === 'source-missing' && resolved.text.trim()) {
      errors.push(`「${slot.label}」有正文，不能标「源文无此段」`)
    }
    if (decision.status === 'corrected') {
      const text = (decision.text ?? '').trim()
      const reason = (decision.reason ?? '').trim()
      if (!text) errors.push(`「${slot.label}」标了需修正但未填正文`)
      if (!reason) errors.push(`「${slot.label}」修正未填原因`)
      if (!text || !reason) continue
      const sourceKey = resolved.sourceKey ?? slot.sourceKeys[0]
      base.corrections.push({
        field: slot.key,
        sourceKey,
        from: resolved.text,
        to: text,
        reason,
        mapped: mappedValue(slot.key, text),
      })
    }
  }

  if (errors.length === 0) {
    base.reviewMeta = {
      version: 1,
      sections: statuses,
      optionalSections: 'verified',
      corrections: base.corrections.map((c) => ({ field: c.field, from: c.from, to: c.to, reason: c.reason })),
    }
    base.note = '可升 reviewed'
  }
  return base
}

function mappedValue(key: RequiredSectionKey, text: string): Record<string, unknown> {
  switch (key) {
    case 'indication':
      return { indication: text }
    case 'contraindication':
      return { contraindications: [text] }
    case 'precautions':
      return { precautions: [text] }
    case 'adverse':
      return { adverseReactions: text }
    case 'interactions':
      return { interactions: text }
    case 'dosage':
      return { dosage: { raw: text } }
  }
}
