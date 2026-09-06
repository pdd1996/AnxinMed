/**
 * API 输入契约（请求体 zod schema）—— 前后端一份真相（ADR #10）。
 * api 用 @hono/zod-validator 校验；web 表单（T8/T9）复用同一份。
 *
 * 医嘱只抄录不生成（执行总纲 §3.2.2）：这些是"手动建档/手动建计划"的用户自填入参，
 * 不含任何模型输出通道；处方来源的计划走 M2 确认页事务，不经此。
 */
import { z } from 'zod'
import { CycleTypeSchema, PlanStatusSchema, RecordStatusSchema } from './enums.js'
import { DoseSchema } from './dto.js'

// ── 药箱（手动建档 / 编辑）──

/** POST /api/drugs：手动建档（confirmStatus 由服务端固定为 'manual'，不在入参）。 */
export const DrugCreateSchema = z.object({
  genericName: z.string().min(1),
  brandName: z.string().nullish(),
  specification: z.string().nullish(),
  form: z.string().nullish(),
  manufacturer: z.string().nullish(),
  stock: DoseSchema.nullish(),
  openedAt: z.string().nullish(), // ISO date
  expiry: z.string().nullish(), // ISO date
})
export type DrugCreate = z.infer<typeof DrugCreateSchema>

/** PATCH /api/drugs/:id：部分更新。 */
export const DrugPatchSchema = DrugCreateSchema.partial()
export type DrugPatch = z.infer<typeof DrugPatchSchema>

// ── 计划（手动建 / 编辑 / 状态变更）──

/**
 * POST /api/plans：手动建计划。
 * times 缺省 → 服务端 suggestTimes(frequency) 并标 assist；
 * startDate 缺省 → 今天并标 default（任务书 T7 默认值标注规则）。
 */
export const PlanCreateSchema = z.object({
  drugId: z.string().min(1),
  dose: DoseSchema,
  frequency: z.number().int().positive(),
  times: z.array(z.string()).optional(),
  route: z.string().nullish(),
  meal: z.string().nullish(),
  cycleType: CycleTypeSchema,
  startDate: z.string().optional(), // ISO date
  endDate: z.string().nullish(), // ISO date（closed 用）
})
export type PlanCreate = z.infer<typeof PlanCreateSchema>

/** PATCH /api/plans/:id：暂停/恢复/结束（status）或编辑字段。 */
export const PlanPatchSchema = z.object({
  status: PlanStatusSchema.optional(),
  dose: DoseSchema.optional(),
  frequency: z.number().int().positive().optional(),
  times: z.array(z.string()).optional(),
  route: z.string().nullish(),
  meal: z.string().nullish(),
  cycleType: CycleTypeSchema.optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullish(),
})
export type PlanPatch = z.infer<typeof PlanPatchSchema>

// ── 服药记录 ──

/** POST /api/records：{ planId, date, time, status }（任务书 T7；替代 take|later|skip 三路由）。 */
export const RecordCreateSchema = z.object({
  planId: z.string().min(1),
  date: z.string().min(1), // ISO date
  time: z.string().min(1), // "HH:MM"
  status: RecordStatusSchema,
})
export type RecordCreate = z.infer<typeof RecordCreateSchema>

/**
 * GET /api/records?from&to：按日期范围查询服药记录（M3-T6 · PRD §7.4 沿用 V1 §7.5「按日周月查询与导出」）。
 * from/to 为 ISO date（YYYY-MM-DD）；日/周/月的具体区间由前端换算后传入。from 不得晚于 to。
 */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const RecordsQuerySchema = z
  .object({
    from: z.string().regex(ISO_DATE_PATTERN, 'from 需为 YYYY-MM-DD'),
    to: z.string().regex(ISO_DATE_PATTERN, 'to 需为 YYYY-MM-DD'),
  })
  .refine((v) => v.from <= v.to, { message: 'from 不能晚于 to', path: ['from'] })
export type RecordsQuery = z.infer<typeof RecordsQuerySchema>

// ── 健康信息（我的页手动填写；字段级来源标「用户自述」，PRD §7.1.2）──

/** 健康信息字段选项（对齐 demo Profile 的 HEALTH_FIELDS；fieldKey 直接用中文标签）。 */
export const HEALTH_FIELDS = ['性别', '年龄', '出生年月', '过敏史', '特殊状态', '紧急联系人', '诊断'] as const
export type HealthField = (typeof HEALTH_FIELDS)[number]

/** PATCH /api/profile 的单条 upsert（按 fieldKey）。 */
export const HealthEntryUpsertSchema = z.object({
  fieldKey: z.string().min(1),
  value: z.string().min(1),
})
export type HealthEntryUpsert = z.infer<typeof HealthEntryUpsertSchema>

/** PATCH /api/profile：health_profiles 按字段 upsert / 删除。 */
export const ProfilePatchSchema = z.object({
  upserts: z.array(HealthEntryUpsertSchema).optional(),
  deletes: z.array(z.string().min(1)).optional(),
})
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>

// ── AI 咨询（M3-T1 · PRD §7.5）──

/**
 * POST /api/consult：围绕已确认药品提问。
 *
 * drugIds 允许为空数组：L4 紧急信号（胸痛/急救词）与 L3 拒答（停药/换药/剂量）
 * 可在无药上下文时触发（用户可能直接打「我胸痛」）；L1/L2/manual-gate/no-source
 * 路径要求至少一个已确认药品（service 层校验）。
 */
export const ConsultRequestSchema = z.object({
  question: z.string().trim().min(1, '请输入咨询问题').max(2000),
  drugIds: z.array(z.string().min(1)).default([]),
})
export type ConsultRequest = z.infer<typeof ConsultRequestSchema>

// ── 医生端洞察（M3-T3 · PRD §7.7）──

/** POST /api/insight/summary：选定患者 → 组装 5 类数据 → Baichuan 生成摘要。 */
export const InsightSummaryRequestSchema = z.object({
  patientId: z.string().trim().min(1, '请提供 patientId'),
})
export type InsightSummaryRequest = z.infer<typeof InsightSummaryRequestSchema>
