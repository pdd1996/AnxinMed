/**
 * 录入草稿契约（M2-T6）—— 前后端一份真相。
 *
 * 覆盖：草稿枚举 / intake 请求体 / 计划草稿 / 冲突清单 / 健康建议 / confirm·reject 请求体。
 * `DraftPayload`（drafts.payload jsonb 的完整形态）是 api 侧 TS 接口（services/pipeline/types.ts），
 * 组合此处的子 schema + api 内部类型；GET /api/drafts/:id 的响应类型经 hc<AppType> 端到端推导给 web。
 */
import { z } from 'zod'
import { ConfirmStatusSchema, CycleTypeSchema } from './enums.js'
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

// ── 草稿确认 / 拒绝（确认页是唯一闸门；PRD §7.2.5）──
// 客户端提交「已核对/已修正的最终决策」；追溯上下文（来源类型/白名单快照/裁剪引用/脱敏审计/确认留痕）
// 由服务端从已存 drafts.payload 取，客户端无法伪造。医嘱字段如有修正，tags 标 'user'（§7.2.4）。

/** 确认后的药品档案（用户核对/从冲突清单选候选/手填后的最终身份）。 */
export const DraftConfirmDrugSchema = z.object({
  genericName: z.string().min(1),
  brandName: z.string().nullish(),
  specification: z.string().nullish(),
  form: z.string().nullish(),
  manufacturer: z.string().nullish(),
  /** 选中候选的 drug_master.id（唯一匹配/用户从冲突清单选定）；手动建档为 null。 */
  drugMasterId: z.string().nullish(),
  confirmStatus: ConfirmStatusSchema,
  stock: DoseSchema.nullish(),
  openedAt: z.string().nullish(),
  expiry: z.string().nullish(),
})
export type DraftConfirmDrug = z.infer<typeof DraftConfirmDrugSchema>

/** 确认后的计划（疗程三选一已在确认页落定，cycleType 不含 'pending'）；入口B 建档通常为 null。 */
export const DraftConfirmPlanSchema = z.object({
  dose: DoseSchema,
  frequency: z.number().int().positive(),
  times: z.array(z.string()).min(1),
  route: z.string().nullish(),
  meal: z.string().nullish(),
  cycleType: CycleTypeSchema,
  startDate: z.string().min(1),
  endDate: z.string().nullish(),
  /** 四类标注：用户修正的医嘱字段标 'user'；缺省则沿用草稿 planDraft.tags。 */
  tags: PlanTagsSchema.nullish(),
})
export type DraftConfirmPlan = z.infer<typeof DraftConfirmPlanSchema>

/** POST /api/drafts/:id/confirm：单事务原子写 drugs+plans+sources+health_profiles+drafts.status。 */
export const DraftConfirmSchema = z.object({
  drug: DraftConfirmDrugSchema,
  plan: DraftConfirmPlanSchema.nullish(),
  /** 健康信息勾选项（只写勾选的；PRD §7.1.2 入口二）。 */
  health: z.array(z.object({ fieldKey: z.string().min(1), value: z.string().min(1) })).nullish(),
  /** 确认方式（留痕）；缺省则服务端按 confirmStatus 推导。 */
  method: z.string().nullish(),
})
export type DraftConfirm = z.infer<typeof DraftConfirmSchema>

/** POST /api/drafts/:id/reject：信息不符 → status=rejected 留痕。 */
export const DraftRejectSchema = z.object({
  reason: z.string().nullish(),
})
export type DraftReject = z.infer<typeof DraftRejectSchema>
