/**
 * 队列级语义查询工具注册表（T7.3 · ADR #17 第 1 条）——零 LLM、确定性。
 *
 * 工具 = zod 参数 schema + repo 只读函数 + 结果契约 + 图表模板绑定；SQL 本体是静态代码，
 * 调用方能决定的只有「调哪个工具 + 填什么参数」，参数必须过 `safeParse`（失败抛错可见，
 * 禁静默吞错）。**模型输出永不以 SQL 形态直通数据库**（AGENTS.md 硬性边界）。
 *
 * 分档判定不在本层实现——统一调用 @anxin/shared gradeAdherence（LLM 不做分类器）。
 *
 * 图表绑定（spec §T7.5）：adherence_distribution → 分档分布直方图；patient_cohort →
 * 队列表格；risk_event_rollup → 事件时间线。三模板由前端按结果契约渲染，后端不生成图片。
 *
 * 扩展位（ADR #17 第 2 条，本期不实现）：漏判长尾走 Qwen function calling 兜底时，
 * 本注册表即 tool 定义的唯一来源——届时补 zod→JSON Schema 导出（zod v3 需 zod-to-json-schema）
 * 供 DashScope `tools` 参数，tool_call 参数仍走本文件 safeParse 执行，无新增执行面。
 */
import { z } from 'zod'
import {
  ADHERENCE_GRADE_LABEL,
  AdherenceGradeSchema,
  type AdherenceGrade,
  type InsightPatient,
} from '@anxin/shared'
import {
  listPatientsWithStats,
  listRiskEventsWindow,
  type PatientListItem,
} from '../../repositories/insight.repo.js'

// ---------------------------------------------------------------------------
// 工具名与参数 schema（.strict() 拒绝多余字段——模型幻觉参数直接校验失败，错误可见）
// ---------------------------------------------------------------------------

export const QUEUE_TOOL_NAMES = ['adherence_distribution', 'patient_cohort', 'risk_event_rollup'] as const
export type QueueToolName = (typeof QUEUE_TOOL_NAMES)[number]

const DaysSchema = z.number().int().min(7).max(90).default(30)

/** adherence_distribution 参数：统计窗口（天）。 */
export const AdherenceDistributionParamsSchema = z.object({ days: DaysSchema }).strict()
/** patient_cohort 参数：目标分档 + 统计窗口（天）。 */
export const PatientCohortParamsSchema = z.object({ grade: AdherenceGradeSchema, days: DaysSchema }).strict()
/** risk_event_rollup 参数：聚合窗口（天）。 */
export const RiskEventRollupParamsSchema = z.object({ days: DaysSchema }).strict()

// ---------------------------------------------------------------------------
// 结果契约（前端图表模板按此渲染；LLM context 由 service 层从结果做字段最小化）
// ---------------------------------------------------------------------------

/** 分档计数（口径 = shared gradeAdherence；ungraded = 窗口内无打卡记录）。 */
export interface GradeCounts {
  good: number
  fair: number
  poor: number
  ungraded: number
}

export interface AdherenceDistributionResult {
  tool: 'adherence_distribution'
  days: number
  total: number
  grades: GradeCounts
  patients: Array<Pick<PatientListItem, 'id' | 'name' | 'adherenceRate' | 'adherenceGrade'>>
}

export interface PatientCohortResult {
  tool: 'patient_cohort'
  days: number
  grade: AdherenceGrade
  gradeLabel: string
  count: number
  patients: InsightPatient[]
}

export interface RiskEventRollupResult {
  tool: 'risk_event_rollup'
  days: number
  total: number
  /** 按 UTC 日 × 级别聚合（口径同 insight/types.ts toRiskEventItem），date 升序。 */
  timeline: Array<{ date: string; level: 'L4' | 'L3' | 'manual-gate'; count: number }>
}

export type QueueToolResult = AdherenceDistributionResult | PatientCohortResult | RiskEventRollupResult

/** 分档计数纯函数（供本工具与 service 层队列视图共用，口径一份真相）。 */
export function countGrades(patients: Array<{ adherenceGrade: AdherenceGrade | null }>): GradeCounts {
  const grades: GradeCounts = { good: 0, fair: 0, poor: 0, ungraded: 0 }
  for (const p of patients) {
    if (p.adherenceGrade === 'good') grades.good++
    else if (p.adherenceGrade === 'fair') grades.fair++
    else if (p.adherenceGrade === 'poor') grades.poor++
    else grades.ungraded++
  }
  return grades
}

/** 时间线聚合纯函数：原始行 → 按 UTC 日 × 级别计数，date 升序。 */
export function rollupTimeline(
  rows: Array<{ date: string; level: 'L4' | 'L3' | 'manual-gate' }>,
): RiskEventRollupResult['timeline'] {
  const acc = new Map<string, { date: string; level: 'L4' | 'L3' | 'manual-gate'; count: number }>()
  for (const r of rows) {
    const key = `${r.date}|${r.level}`
    const cur = acc.get(key)
    if (cur) cur.count++
    else acc.set(key, { date: r.date, level: r.level, count: 1 })
  }
  return [...acc.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

// ---------------------------------------------------------------------------
// 工具执行器（参数 safeParse 失败抛 Error——错误可见，绝不猜参数执行）
// ---------------------------------------------------------------------------

export async function runAdherenceDistribution(raw: unknown): Promise<AdherenceDistributionResult> {
  const params = AdherenceDistributionParamsSchema.safeParse(raw)
  if (!params.success) {
    throw new Error(`adherence_distribution 参数非法：${params.error.message}`)
  }
  const patients = await listPatientsWithStats(params.data.days)
  return {
    tool: 'adherence_distribution',
    days: params.data.days,
    total: patients.length,
    grades: countGrades(patients),
    patients: patients.map((p) => ({
      id: p.id,
      name: p.name,
      adherenceRate: p.adherenceRate,
      adherenceGrade: p.adherenceGrade,
    })),
  }
}

export async function runPatientCohort(raw: unknown): Promise<PatientCohortResult> {
  const params = PatientCohortParamsSchema.safeParse(raw)
  if (!params.success) {
    throw new Error(`patient_cohort 参数非法：${params.error.message}`)
  }
  const { grade, days } = params.data
  const all = await listPatientsWithStats(days)
  const hit = all.filter((p) => p.adherenceGrade === grade)
  return {
    tool: 'patient_cohort',
    days,
    grade,
    gradeLabel: ADHERENCE_GRADE_LABEL[grade],
    count: hit.length,
    patients: hit.map((p) => ({
      id: p.id,
      name: p.name,
      age: p.age,
      gender: p.gender,
      conditions: p.conditions,
      drugCount: p.drugCount,
      enrolledAt: p.enrolledAt,
      lastActiveAt: p.lastActiveAt,
      adherenceRate: p.adherenceRate,
      adherenceGrade: p.adherenceGrade,
    })),
  }
}

export async function runRiskEventRollup(raw: unknown): Promise<RiskEventRollupResult> {
  const params = RiskEventRollupParamsSchema.safeParse(raw)
  if (!params.success) {
    throw new Error(`risk_event_rollup 参数非法：${params.error.message}`)
  }
  const rows = await listRiskEventsWindow(params.data.days)
  const timeline = rollupTimeline(rows)
  return {
    tool: 'risk_event_rollup',
    days: params.data.days,
    total: rows.length,
    timeline,
  }
}

// ---------------------------------------------------------------------------
// 注册表（工具名 → label / 图表模板 / 参数 schema / 执行器；意图路由与未来 FC 兜底共用）
// ---------------------------------------------------------------------------

export interface QueueToolDef {
  label: string
  /** 图表模板绑定（spec §T7.5 三件；前端按此选择渲染组件）。 */
  chart: 'histogram' | 'table' | 'timeline'
  paramSchema: z.ZodType
  run: (raw: unknown) => Promise<QueueToolResult>
}

export const QUEUE_TOOLS: Record<QueueToolName, QueueToolDef> = {
  adherence_distribution: {
    label: '依从性分档分布',
    chart: 'histogram',
    paramSchema: AdherenceDistributionParamsSchema,
    run: runAdherenceDistribution,
  },
  patient_cohort: {
    label: '分档患者队列',
    chart: 'table',
    paramSchema: PatientCohortParamsSchema,
    run: runPatientCohort,
  },
  risk_event_rollup: {
    label: '风险事件聚合',
    chart: 'timeline',
    paramSchema: RiskEventRollupParamsSchema,
    run: runRiskEventRollup,
  },
}

/** 统一工具执行入口：执行器内部先 safeParse（校验与执行同源，杜绝旁路），失败抛错可见。 */
export async function runQueueTool(name: QueueToolName, raw: unknown): Promise<QueueToolResult> {
  return QUEUE_TOOLS[name].run(raw ?? {})
}
