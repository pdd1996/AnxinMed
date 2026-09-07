/**
 * 咨询服务内部类型（M3-T1 · PRD §7.5）。
 *
 * 分层：
 * - InsertSlice / ConsultDrug：从 repository 取到的最小切片（避免把整库拖进内存）；
 * - GuardDecision：guards.ts 纯函数产物，run.ts 按 kind 分派；
 * - InteractionContext：M2-T5 checkInteractions 的裁剪形态，供 prompt 注入；
 * - ConsultRunInput / ConsultRunResult：run.ts 编排层的输入输出。
 *
 * ⚠️ LLM 边界类型（ConsultRawSections / ConsultPromptPayload / AiClients）统一由 lib/ai/types.ts 提供，
 *    本文件仅 re-export，避免重复定义导致类型不兼容。
 */
import type { ConfirmStatus, InteractionLevel, RiskLevel } from '@anxin/shared'
import type { AiClients, ConsultPromptPayload, ConsultRawSections } from '../../lib/ai/types.js'

export type { AiClients, ConsultPromptPayload, ConsultRawSections }

// ---------------------------------------------------------------------------
// 数据切片（repository 层裁剪后的最小可用形态）
// ---------------------------------------------------------------------------

/**
 * 说明书切片（package_inserts 行 → 按键取数所需列）。
 * jsonb 列（dosage / contraindications / precautions）保留 unknown，sections.ts 内做窄化。
 */
export interface InsertSlice {
  drugId: string
  genericName: string
  brandName: string | null
  specification: string | null
  form: string | null
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
  source: string | null
  version: string | null
}

/**
 * 咨询对象（用户域药品 + 命中说明书）。
 * - `id`：drugs.id（用户域）；
 * - `drugMasterId`：drug_master.id（可空——手动建档为 null）；
 * - `confirmStatus`：确认状态三档（manual 触发 L0 门禁）；
 * - `insert`：按 drugMasterId 直查命中，或 manual 档按药名兜底命中；null 表示本地库未收录。
 */
export interface ConsultDrug {
  id: string
  drugMasterId: string | null
  genericName: string
  brandName: string | null
  confirmStatus: ConfirmStatus
  insert: InsertSlice | null
}

// ---------------------------------------------------------------------------
// 守门决策（guards.ts 纯函数产物；run.ts 按 kind 分派）
// ---------------------------------------------------------------------------

/**
 * 守门决策：按优先级先命中先返回。
 * - `emergency`：L4 紧急信号（附命中关键词，供 risk_events.detail 留痕）
 * - `refused`：L3 拒答（附命中关键词）
 * - `manual-gate`：manual 档药品拒绝个体化解释（仅可 L0 资料查询，接口层拒绝）
 * - `no-source`：本地说明书库未命中（且医疗搜索默认关）
 * - `proceed`：进入生成路径（Baichuan 或降级规则拼装）
 */
export type GuardDecision =
  | { kind: 'emergency'; matched: string }
  | { kind: 'refused'; matched: string }
  | { kind: 'manual-gate' }
  | { kind: 'no-source' }
  | { kind: 'proceed' }

// ---------------------------------------------------------------------------
// 相互作用上下文（M2-T5 checkInteractions 的裁剪形态，供 prompt 注入）
// ---------------------------------------------------------------------------

export interface InteractionContextItem {
  level: InteractionLevel
  note: string
  source: string
  drugNames: string[]
}

export interface InteractionContext {
  has: boolean
  items: InteractionContextItem[]
  /** 生效集合 ≥2 药但无规则命中时的安全提示（未覆盖 ≠ 无风险）。 */
  coverageNote: string | null
}

// ---------------------------------------------------------------------------
// 编排层输入输出
// ---------------------------------------------------------------------------

/** 归一化后的结构化回答（前端消费形态，与 shared ConsultSections 对齐）。 */
export interface NormalizedSections {
  summary: string
  keyPoints: string[]
  risks: string[]
  nextAction: string
  warning: string
  /** true 表示 stripDosageAdvice 命中过（L2）；run.ts 据此决定 status/riskLevel。 */
  limited: boolean
}

/** 引用三件套（PRD §7.5）：药名 + 来源 + 版本。 */
export interface Citation {
  drugName: string
  source: string
  version: string
  /** 网络检索兜底时 true；本地说明书库为 false。 */
  unverified: boolean
}

/** runConsult 输入（路由层组装：DB 取数 + 用户提问 + env 开关）。 */
export interface ConsultRunInput {
  question: string
  /** 咨询对象（按用户 drugIds[] 解析而来；空数组 = 无药上下文，仅 L4/L3 可触发）。 */
  drugs: ConsultDrug[]
  /** 生效计划集合的 drug_master.id（供相互作用注入）；空数组 = 无生效计划。 */
  activeMasterIds: string[]
  /** 相互作用规则（全量或按相关药预筛）；由 repository 提供。 */
  interactionRules: Array<{ id: string; drugIds: string[]; level: InteractionLevel; note: string; source: string }>
  /** drug_master.id → 通用名（供命中项展示）。 */
  drugNameById: Record<string, string>
  /** env 开关：本地未命中该药品时才兜底开 Baichuan 医疗搜索（默认 false）。 */
  enableMedicalSearch: boolean
  /** AI 客户端注入接缝（M2-T1）；测试注入 mock，生产为 baichuan。 */
  ai: AiClients
}

/** runConsult / runDataQuery 输出（路由层落库 + 返回给前端）。 */
export interface ConsultRunResult {
  riskLevel: RiskLevel
  status:
    | 'answered'
    | 'limited'
    | 'refused'
    | 'emergency'
    | 'manual-gate'
    | 'no-source'
    | 'ai-unavailable'
    | 'data-answered'
  answer: string
  sections: NormalizedSections | null
  citations: Citation[]
  notice: string | null
  l0Notice: string | null
  blocked: boolean
  /** 命中关键词（L4/L3 时非空，供 risk_events.detail 留痕）。 */
  matchedKeyword: string | null
  /** 触发拦截的药品 id（供 risk_events.drugId 留痕）。 */
  triggerDrugId: string | null
  /**
   * 数据查询路径（status='data-answered'）使用的只读工具名（= QueryIntent 值，如
   * 'medication-list'）；其余回答路径缺省。可选——run.ts 现有返回路径不含此字段亦合法。
   */
  toolUsed?: string | null
}
