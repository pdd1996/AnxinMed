/**
 * 说明书 PDF 草稿契约（import-manuals / repair-specs 共用）。
 *
 * 从 import-manuals.ts 抽出的纯定义，不含任何 I/O 与 main 逻辑，
 * 这样脚本之间共用同一份 zod 契约，避免两处漂移。
 */
import { z } from 'zod'
import { PRODUCT_TYPES } from './schema.js'

export const ManualDraftSchema = z
  .object({
    source: z.literal('manual-pdf'),
    sourceFile: z.string().min(1),
    sourceRecordIds: z.array(z.string()).default([]),
    extractedAt: z.string().min(1),
    pdfCreatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    extractorVersion: z.string().nullable().default(null),
    pageCount: z.number().int().positive().nullable().default(null),
    sourceFileHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
    drugId: z.string().regex(/^drug-[a-z0-9]+(-[a-z0-9]+)*$/, 'drugId 须为 drug-* 小写连字符形式'),
    genericName: z.string().min(1),
    brandName: z.string().nullable().default(null),
    englishName: z.string().nullable().default(null),
    pinyin: z.string().nullable().default(null),
    form: z.string().min(1),
    productType: z.enum(PRODUCT_TYPES).nullable().default(null),
    specification: z.string().min(1),
    approvalNumbers: z.array(z.string()).default([]),
    manufacturer: z.string().nullable().default(null),
    repackager: z.string().nullable().default(null),
    executionStandard: z.string().nullable().default(null),
    shelfLife: z.string().nullable().default(null),
    version: z.string().regex(/^(nmpa|pdf)-.+$/, 'version 须为 nmpa-* 或 pdf-*'),
    sections: z.record(z.string()),
    curationStatus: z.literal('crawled'),
    curationNote: z.string().default(''),
  })
  .refine((d) => Object.keys(d.sections).length > 0, { message: 'sections 不能为空' })

export type Draft = z.infer<typeof ManualDraftSchema>

export const MAPPED_COLUMNS = [
  'genericName', 'brandName', 'form', 'specification',
  'indication', 'components', 'dosage', 'contraindications', 'adverseReactions', 'precautions',
  'interactions', 'pharmacology', 'pharmacokinetics', 'storage', 'afterOpeningDays',
  'source', 'version', 'sourceUrl', 'sourceDocumentId', 'contentHash', 'sourceSections', 'sourceFile',
  'sourceRecordIds', 'approvalNumbers', 'curationNote',
] as const

export type MappedColumn = (typeof MAPPED_COLUMNS)[number]

export interface MappedInsertValues {
  genericName: string
  brandName: string | null
  form: string | null
  specification: string | null
  indication: string | null
  components: string | null
  dosage: unknown
  contraindications: unknown
  adverseReactions: string | null
  precautions: unknown
  interactions: string | null
  pharmacology: string | null
  pharmacokinetics: string | null
  storage: string | null
  afterOpeningDays: number | null
  source: string | null
  version: string | null
  sourceUrl: string | null
  sourceDocumentId: string
  contentHash: string
  sourceSections: Record<string, string>
  sourceFile: string
  sourceRecordIds: string[]
  approvalNumbers: string[]
  curationNote: string | null
}

export function buildSource(d: Pick<Draft, 'pdfCreatedAt'>): string {
  return `说明书 PDF（本地资料库${d.pdfCreatedAt ? `，PDF 批次 ${d.pdfCreatedAt}` : ''}）`
}

export function mapDraftToInsertValues(d: Draft, sourceDocumentId: string, contentHash: string): MappedInsertValues {
  return {
    genericName: d.genericName,
    brandName: d.brandName,
    form: d.form,
    specification: d.specification,
    indication: d.sections['适应症'] ?? null,
    components: d.sections['成份'] ?? null,
    dosage: d.sections['用法用量'] ? { raw: d.sections['用法用量'] } : null,
    contraindications: d.sections['禁忌'] ? [d.sections['禁忌']] : null,
    adverseReactions: d.sections['不良反应'] ?? null,
    precautions: d.sections['注意事项'] ? [d.sections['注意事项']] : null,
    interactions: d.sections['药物相互作用'] ?? null,
    pharmacology: d.sections['药理毒理'] ?? d.sections['药理作用'] ?? null,
    pharmacokinetics: d.sections['药代动力学'] ?? null,
    storage: d.sections['贮藏'] ?? null,
    afterOpeningDays: null,
    source: buildSource(d),
    version: d.version,
    sourceUrl: null,
    sourceDocumentId,
    contentHash,
    sourceSections: d.sections,
    sourceFile: d.sourceFile,
    sourceRecordIds: d.sourceRecordIds,
    approvalNumbers: d.approvalNumbers,
    curationNote: d.curationNote,
  }
}
