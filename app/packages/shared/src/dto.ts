/**
 * DTO zod schema —— API 传输形态，与 DB 行结构对应。
 * 日期字段用 string 传输（ISO date "YYYY-MM-DD" / 时间点 "HH:MM" / datetime ISO）。
 * T4 建骨架定契约；.strict() 闭合只用于 L1 白名单（见 whitelist.ts，M2 用）。
 */
import { z } from 'zod'
import {
  ConfirmStatusSchema,
  CycleTypeSchema,
  PlanSourceSchema,
  PlanStatusSchema,
  RecordStatusSchema,
  RiskLevelSchema,
  SourceTypeSchema,
  TagKindSchema,
} from './enums.js'

/** 剂量 / 库存 { value, unit } */
export const DoseSchema = z.object({
  value: z.number(),
  unit: z.string(),
})
export type Dose = z.infer<typeof DoseSchema>

/** 计划四类标注：字段 → TagKind（PRD §7.2.4；全部可选） */
export const PlanTagsSchema = z
  .object({
    dose: TagKindSchema,
    frequency: TagKindSchema,
    duration: TagKindSchema,
    times: TagKindSchema,
    startDate: TagKindSchema,
    endDate: TagKindSchema,
  })
  .partial()
export type PlanTags = z.infer<typeof PlanTagsSchema>

/** 药品（用户药箱行 → 传输） */
export const DrugDTO = z.object({
  id: z.string(),
  genericName: z.string(),
  brandName: z.string().nullish(),
  specification: z.string().nullish(),
  form: z.string().nullish(),
  manufacturer: z.string().nullish(),
  drugMasterId: z.string().nullish(),
  confirmStatus: ConfirmStatusSchema,
  stock: DoseSchema.nullish(),
  openedAt: z.string().nullish(),
  expiry: z.string().nullish(),
  sourceId: z.string().nullish(),
  confirmedAt: z.string(),
})
export type DrugDTOType = z.infer<typeof DrugDTO>

/** 计划（行 → 传输） */
export const PlanDTO = z.object({
  id: z.string(),
  drugId: z.string(),
  dose: DoseSchema,
  frequency: z.number().int().positive(),
  times: z.array(z.string()),
  route: z.string().nullish(),
  meal: z.string().nullish(),
  cycleType: CycleTypeSchema,
  startDate: z.string(),
  endDate: z.string().nullish(),
  status: PlanStatusSchema,
  source: PlanSourceSchema,
  sourceId: z.string().nullish(),
  itemId: z.string().nullish(),
  tags: PlanTagsSchema.nullish(),
})
export type PlanDTOType = z.infer<typeof PlanDTO>

/** 服药记录（行 → 传输） */
export const RecordDTO = z.object({
  id: z.string(),
  planId: z.string(),
  scheduledDate: z.string(),
  scheduledTime: z.string(),
  status: RecordStatusSchema,
  actedAt: z.string(),
})
export type RecordDTOType = z.infer<typeof RecordDTO>

/** 健康信息（字段级来源标注，PRD §7.1.2） */
export const HealthEntryDTO = z.object({
  id: z.string(),
  fieldKey: z.string(),
  value: z.string().nullish(),
  sourceMeta: z
    .object({
      source: z.enum(['self_reported', 'prescription_confirmed']),
      confirmedAt: z.string().optional(),
    })
    .nullish(),
})
export type HealthEntryDTOType = z.infer<typeof HealthEntryDTO>

/** 来源（三层追溯锚点，PRD §7.2.5） */
export const SourceDTO = z.object({
  id: z.string(),
  type: SourceTypeSchema,
  bodyImageRef: z.string().nullish(),
  whitelistFields: z.unknown().nullish(),
  prescriptionNo: z.string().nullish(),
  confirmTrace: z.unknown().nullish(),
  sanitizeAudit: z.record(z.number()).nullish(),
})
export type SourceDTOType = z.infer<typeof SourceDTO>

// ── AI 咨询响应（M3-T1 · PRD §7.5）──

/**
 * 咨询结果状态（守门与生成路径的联合出口，与 consult_logs.status 枚举一致）：
 *   answered        L1 正常回答
 *   limited         L2 剂量过滤后回答
 *   refused         L3 拒答（停药/换药/剂量调整）
 *   emergency       L4 紧急信号（引导急救）
 *   manual-gate     manual 档药品拒绝个体化解释（仅可 L0 资料查询）
 *   no-source       本地说明书库未命中（且医疗搜索默认关）
 *   ai-unavailable  Baichuan 不可用 → 降级
 */
export const ConsultStatusSchema = z.enum([
  'answered',
  'limited',
  'refused',
  'emergency',
  'manual-gate',
  'no-source',
  'ai-unavailable',
])
export type ConsultStatus = z.infer<typeof ConsultStatusSchema>

/** 结构化回答分区（前端分段展示，避免一大块文字）。 */
export const ConsultSectionsSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  risks: z.array(z.string()),
  nextAction: z.string(),
  warning: z.string(),
})
export type ConsultSections = z.infer<typeof ConsultSectionsSchema>

/** 引用三件套（PRD §7.5）：药名 + 来源 + 版本（本地说明书库或网络检索兜底）。 */
export const CitationSchema = z.object({
  drugName: z.string(),
  source: z.string(),
  version: z.string(),
  /** 兜底网络检索时为 true；前端渲染「未经本库核实」徐章。 */
  unverified: z.boolean().optional(),
})
export type Citation = z.infer<typeof CitationSchema>

/**
 * POST /api/consult 响应体。
 * - `answer` 为 `sections.summary` 的别名（方便前端直接取一句话）；
 * - `blocked=true` 时 `sections` 仅包含守门固定文案（不是 LLM 生成），前端可隐藏「下一步」以外的建议内容。
 */
export const ConsultResponseSchema = z.object({
  riskLevel: RiskLevelSchema,
  status: ConsultStatusSchema,
  answer: z.string(),
  sections: ConsultSectionsSchema.nullish(),
  citations: z.array(CitationSchema).default([]),
  notice: z.string().nullish(),
  l0Notice: z.string().nullish(),
  blocked: z.boolean().default(false),
})
export type ConsultResponse = z.infer<typeof ConsultResponseSchema>
