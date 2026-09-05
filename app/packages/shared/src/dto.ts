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
