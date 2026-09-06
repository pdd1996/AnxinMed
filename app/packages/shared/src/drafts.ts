/**
 * 录入草稿契约（M2-T6）—— 前后端一份真相。
 *
 * 覆盖：草稿枚举 / intake 请求体 / 计划草稿 / 冲突清单 / 健康建议。
 * `DraftPayload`（drafts.payload jsonb 的完整形态）是 api 侧 TS 接口（services/pipeline/types.ts），
 * 组合此处的子 schema + api 内部类型；GET /api/drafts/:id 的响应类型经 hc<AppType> 端到端推导给 web。
 * confirm/reject 请求体（DraftConfirmSchema/DraftRejectSchema）在 T6b 追加。
 */
import { z } from 'zod'
import { DoseSchema, PlanTagsSchema } from './dto.js'

// ── 草稿枚举 ──

/** 草稿类型：处方笺入口A / 药品入口B（对应 drafts.type）。 */
export const DraftTypeSchema = z.enum(['prescription', 'drug'])
export type DraftType = z.infer<typeof DraftTypeSchema>

/** 草稿状态：待确认 / 已确认 / 已拒绝（对应 drafts.status）。 */
export const DraftStatusSchema = z.enum(['pending', 'confirmed', 'rejected'])
export type DraftStatus = z.infer<typeof DraftStatusSchema>

// ── intake 请求体（图片以 dataURL 传输，对齐 demo + 已有 bodyLimit(22mb)）──

/** 图片 dataURL：仅接受 JPG/PNG/WebP base64。 */
const imageDataUrl = z
  .string()
  .regex(/^data:image\/(?:png|jpe?g|webp);base64,/i, '请上传 JPG、PNG 或 WebP 图片（dataURL 形式）')

/** POST /api/intake/detect：仅层检测（入口校验独立暴露）。entry 可选，提供则附带入口校验建议（不抛错）。 */
export const IntakeDetectSchema = z.object({
  image: imageDataUrl,
  entry: z.enum(['A', 'B']).optional(),
})
export type IntakeDetect = z.infer<typeof IntakeDetectSchema>

/** POST /api/intake/prescription：入口A 全管线（N 条目拆 N 草稿）。 */
export const IntakePrescriptionSchema = z.object({ image: imageDataUrl })
export type IntakePrescription = z.infer<typeof IntakePrescriptionSchema>

/** POST /api/intake/drug：入口B 仅身份线（1 份建档草稿）。 */
export const IntakeDrugSchema = z.object({ image: imageDataUrl })
export type IntakeDrug = z.infer<typeof IntakeDrugSchema>

// ── 计划草稿（管线 ⑦ 产出，确认前形态；cycleType 含 'pending' 表示疗程未定，待确认页三选一）──

export const PlanDraftSchema = z.object({
  dose: DoseSchema.nullable(),
  frequency: z.number().int().nullable(),
  route: z.string().nullable(),
  durationDays: z.number().int().nullable(),
  times: z.array(z.string()),
  startDate: z.string(),
  endDate: z.string().nullable(),
  cycleType: z.enum(['closed', 'open', 'stock', 'pending']),
  /** 医嘱缺失项（dose/frequency 等）——确认页显示原文空输入，绝不预填。 */
  sigMissing: z.array(z.string()),
  /** 四类标注（PRD §7.2.4）。 */
  tags: PlanTagsSchema,
})
export type PlanDraft = z.infer<typeof PlanDraftSchema>

// ── 冲突清单（系统不选边，交确认页用户核对；PRD §8.2）──

/** 候选药品（drug_master 匹配候选 → 传输）。 */
export const DrugCandidateSchema = z.object({
  id: z.string(),
  genericName: z.string(),
  brandName: z.string().nullish(),
  specification: z.string(),
  form: z.string(),
  manufacturer: z.string().nullish(),
  approvalNumber: z.string().nullish(),
})
export type DrugCandidate = z.infer<typeof DrugCandidateSchema>

export const DraftConflictSchema = z.object({
  /** spec=规格冲突 / form=剂型冲突 / multi=多候选 / layer=层间信息冲突。 */
  type: z.enum(['spec', 'form', 'multi', 'layer']),
  note: z.string(),
  field: z.string().nullish(),
  extracted: z.string().nullish(),
  library: z.string().nullish(),
  candidates: z.array(DrugCandidateSchema).nullish(),
})
export type DraftConflict = z.infer<typeof DraftConflictSchema>

// ── 健康信息「建议填入」（处方诊断/性别/年龄 → 勾选才写入 health_profiles；PRD §7.1.2）──

export const HealthSuggestionSchema = z.object({
  field: z.string(),
  value: z.string(),
  source: z.string(),
})
export type HealthSuggestion = z.infer<typeof HealthSuggestionSchema>
