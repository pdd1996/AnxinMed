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
