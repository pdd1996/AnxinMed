/**
 * 医生端洞察服务内部类型（M3-T3 · PRD §7.7）。
 *
 * 分层：
 * - InsightTools：5 个只读工具的聚合产物（供 fallback 与 LLM prompt 消费）；
 * - GuardedSummary：guardSummary 纯函数产物（L4/L3/L2/L1 二次守门后的 sections + riskLevel）；
 * - InsightRunInput / InsightRunResult：run.ts 编排层的输入输出。
 *
 * ⚠️ LLM 边界类型（ConsultRawSections / AiClients）复用 lib/ai/types.ts（M3-T1 已建），
 *    摘要与咨询输出 schema 相同（summary/keyPoints/risks/nextAction/warning）。
 */
import type { RiskEventLevel, RiskEventType, RiskLevel } from '@anxin/shared'
import type { AiClients, ConsultRawSections } from '../../lib/ai/types.js'
import type {
  AdherenceStats,
  ExpiryStatus,
  MedicationItem,
  PatientListItem,
} from '../../repositories/insight.repo.js'
import type { ConsultLogRow, RiskEventRow } from '../../repositories/consult.repo.js'

export type { AiClients, ConsultRawSections }

// ---------------------------------------------------------------------------
// 5 个只读工具的聚合产物
// ---------------------------------------------------------------------------

/** 风险事件流聚合项（risk_events 行 → 医生端展示形态；level 含 manual-gate，非 RiskLevel）。 */
export interface RiskEventItem {
  date: string
  level: RiskEventLevel
  type: RiskEventType
  detail: string
}

/** 风险事件流聚合（risk_events + consult_logs）。 */
export interface RiskEventsSummary {
  events: RiskEventItem[]
  consultCount: number
  lastQuestion: string
  blockedCount: number
  hasL4: boolean
  hasL3: boolean
}

/** 相互作用聚合（复用 M2-T5 checkInteractions 的裁剪形态）。 */
export interface InteractionsSummary {
  hasInteraction: boolean
  items: Array<{ level: string; note: string; drugs: string[] }>
}

/** 5 个只读工具的聚合产物（供 fallback 与 LLM prompt 消费）。 */
export interface InsightTools {
  adherence: AdherenceStats
  medicationList: MedicationItem[]
  interactions: InteractionsSummary
  expiry: ExpiryStatus
  riskEvents: RiskEventsSummary
}

// ---------------------------------------------------------------------------
// 守门产物
// ---------------------------------------------------------------------------

/** guardSummary 产物：二次守门后的 sections + riskLevel。 */
export interface GuardedSummary {
  riskLevel: RiskLevel
  sections: {
    summary: string
    keyPoints: string[]
    risks: string[]
    nextAction: string
    warning: string
  }
}

// ---------------------------------------------------------------------------
// 编排层输入输出
// ---------------------------------------------------------------------------

/** runInsightSummary 输入（service 层组装：DB 取数 + 患者信息 + env 开关）。 */
export interface InsightRunInput {
  patient: PatientListItem
  tools: InsightTools
  dateRange: string
  /** 医生追问（T7 ask 长尾路径）：非空时 LLM 聚焦回答该问题，仍只基于工具输出事实。 */
  question?: string
  /** AI 客户端注入接缝（M2-T1）；测试注入 mock，生产为 baichuan。 */
  ai: AiClients
}

/** runInsightSummary 输出（路由层返回给前端）。 */
export interface InsightRunResult {
  patient: PatientListItem
  riskLevel: RiskLevel
  sections: GuardedSummary['sections']
  tools: InsightTools
  snapshot: {
    generatedAt: string
    dateRange: string
    toolChain: string[]
    mode: 'llm' | 'offline-fallback' | 'error-fallback'
  }
  citations: string[]
  notice?: string
}

/** risk_events 行 → RiskEventsSummary.events 项的映射（供 service 层组装）。 */
export function toRiskEventItem(row: RiskEventRow): RiskEventItem {
  const detail = row.detail as { matchedKeyword?: string; questionRedacted?: string } | null
  return {
    date: row.occurredAt.toISOString().slice(0, 10),
    level: row.level,
    type: row.type,
    detail: detail?.matchedKeyword ? `命中「${detail.matchedKeyword}」` : detail?.questionRedacted ?? '—',
  }
}

/** consult_logs 行 → 最近提问（供 service 层组装 RiskEventsSummary.lastQuestion）。 */
export function toLastQuestion(rows: ConsultLogRow[]): string {
  if (rows.length === 0) return ''
  return rows[0].question.slice(0, 50) // 截断避免长文本
}
