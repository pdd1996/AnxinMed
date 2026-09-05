/**
 * 领域枚举与元数据 —— 前后端一份真相。
 *
 * 值以执行总纲 §2.5「目标值」为准（非 demo 原值）：
 *   - 确认状态三档：transcribed / ocr_matched / manual（demo 的 prescription/ocr-unique 已改名）
 *   - 计划来源：prescription / manual（V2.1 去掉 demo 的 label）
 *   - 任务状态：records 只存 taken/skipped/later；pending = 无记录（运行期计算，不落库）
 *
 * zod schema 为源，TS 类型由 z.infer 派生（单一真相）。
 */
import { z } from 'zod'

// ── 确认状态三档（PRD §7.5 / 总纲 §2.5）──
export const ConfirmStatusSchema = z.enum(['transcribed', 'ocr_matched', 'manual'])
export type ConfirmStatus = z.infer<typeof ConfirmStatusSchema>

// ── 四类标注 + 用户自填（PRD §7.2.4；语义收窄见总纲 §2.5）──
export const TagKindSchema = z.enum(['transcribed', 'assist', 'derived', 'default', 'user'])
export type TagKind = z.infer<typeof TagKindSchema>

// ── 计划周期形态（PRD §7.3.2）：封闭 / 开放 / 用完为止 ──
export const CycleTypeSchema = z.enum(['closed', 'open', 'stock'])
export type CycleType = z.infer<typeof CycleTypeSchema>

// ── 记录状态（落库三档）与任务状态（运行期含 pending）──
export const RecordStatusSchema = z.enum(['taken', 'skipped', 'later'])
export type RecordStatus = z.infer<typeof RecordStatusSchema>
export const TaskStatusSchema = z.enum(['pending', 'taken', 'skipped', 'later'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

// ── 计划状态 ──
export const PlanStatusSchema = z.enum(['active', 'paused', 'ended'])
export type PlanStatus = z.infer<typeof PlanStatusSchema>

// ── 计划来源（V2.1：处方 / 手动；不含 label）──
export const PlanSourceSchema = z.enum(['prescription', 'manual'])
export type PlanSource = z.infer<typeof PlanSourceSchema>

// ── 来源类型（sources.type）──
export const SourceTypeSchema = z.enum(['prescription', 'drug_box', 'manual'])
export type SourceType = z.infer<typeof SourceTypeSchema>

// ── 风险分级（守门 L1–L4；L4 最高）──
export const RiskLevelSchema = z.enum(['L1', 'L2', 'L3', 'L4'])
export type RiskLevel = z.infer<typeof RiskLevelSchema>

// ── 剂量单位（stock / dose 的 unit）──
export const DOSE_UNITS = ['滴', '片', '粒', '支', '袋', '喷', '丸'] as const
export type DoseUnit = (typeof DOSE_UNITS)[number]

// ── 元数据（中文 label/hint，照搬 demo/src/lib.ts，按 §2.5 与 V2.1 收窄语义）──

/** 四类标注元数据。transcribed 去掉 demo 的「/标签」（V2.1 贴标降级）；user 收窄为人工补录的医嘱字段。 */
export const TAG_META: Record<TagKind, { label: string; hint: string }> = {
  transcribed: { label: '抄录', hint: '来自处方原文' },
  assist: { label: '辅助', hint: '系统建议，非医嘱，可调整' },
  derived: { label: '推算', hint: '由已确认信息计算' },
  default: { label: '默认', hint: '系统推断的初始值，可修改' },
  user: { label: '自填', hint: '用户人工补录 / 修正的医嘱字段' },
}

/** 确认状态三档元数据。transcribed 去掉 demo 的「/医院标签」（V2.1）。 */
export const CONFIRM_STATUS_META: Record<ConfirmStatus, { label: string; hint: string }> = {
  transcribed: { label: '处方抄录确认', hint: '用量频次来自处方笺原文，经用户逐项核对' },
  ocr_matched: { label: 'OCR 唯一匹配确认', hint: '药品身份库唯一匹配，经用户核对包装' },
  manual: { label: '手动建档 · 未经 OCR 确认', hint: 'AI 个性化咨询不可用，仅 L0 资料查询' },
}

/** 周期形态元数据。 */
export const CYCLE_META: Record<CycleType, { label: string; hint: string }> = {
  closed: { label: '封闭式', hint: '有疗程，结束日期自动推算' },
  open: { label: '开放式', hint: '长期服用，无结束日期' },
  stock: { label: '用完为止', hint: '按库存推算预计可用天数' },
}
