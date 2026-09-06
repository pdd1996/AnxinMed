/**
 * 管线类型（M2-T6）—— run.ts 编排的输入上下文与产出草稿载荷。
 *
 * 管线铁律（技术方案 §6）：run.ts 是纯编排层，不碰 DB；一切 DB 取数由 intake.service 组成
 * `PipelineContext` 注入。产出 `DraftPayload` 落 drafts.payload（jsonb），并经 GET /api/drafts/:id
 * 的返回类型经 hc<AppType> 端到端推导给 web（确认页 T7 消费）。
 */
import type {
  ConfirmStatus,
  DraftConflict,
  HealthSuggestion,
  LayerLabel,
  PlanDraft,
  PrescriptionItem,
  PrescriptionWhitelistType,
  ErrCode,
} from '@anxin/shared'
import type { IdentityFields } from '../../lib/ai/types.js'
import type { Box } from '../sanitize/crop.js'
import type { DrugMasterCandidate, MatchResult } from '../identity/match.js'
import type { InteractionResult, InteractionRuleInput } from '../rules/interactions.js'
import type { DosageRangeResult, PackageInsertDosage } from '../rules/dosage.js'

/** 录入入口：A=拍处方笺，B=拍药品。 */
export type Entry = 'A' | 'B'

/** 管线上下文（intake.service 从 repo 取数后注入；run.ts 不碰 DB）。 */
export interface PipelineContext {
  /** drug_master 全量候选（身份线三项严格匹配）。 */
  candidates: DrugMasterCandidate[]
  /** interaction_rules（相互作用集合匹配）。 */
  rules: InteractionRuleInput[]
  /** drug_master.id → 通用名（相互作用命中项展示药名）。 */
  drugNameById: Record<string, string>
  /** 用户现有生效计划的 drug_master.id（相互作用「生效集合」基线）。 */
  activeMasterIds: string[]
  /** drug_master.id → 说明书用法用量切片（范围校验）。 */
  insertsByMasterId: Record<string, PackageInsertDosage>
}

/** 档案草稿（确认后拷贝进 drugs 的身份字段；confirmStatus 为初判，确认页可改）。 */
export interface DrugDraft {
  genericName: string
  brandName?: string | null
  specification?: string | null
  form?: string | null
  manufacturer?: string | null
  /** 唯一匹配命中的 drug_master.id；多候选/冲突/无匹配为 null（系统不选边）。 */
  drugMasterId?: string | null
  confirmStatus?: ConfirmStatus
}

/** 降级标记（单步失败转降级，不炸整体；code 复用统一错误码）。 */
export interface Degraded {
  code: ErrCode
  message: string
}

/** 低置信字符（裁剪正文内、去身份；确认页原文对照标红下划线）。 */
export interface LowConfidenceChar {
  text: string
  confidence: number
  box: Box
}

/**
 * 草稿载荷（drafts.payload）—— 确认页唯一闸门前的全部结构化产物。
 * 不变式：一切医嘱/身份字段来自「抄录 + 回链 + 脱敏」或 needsManual 空缺，绝无模型猜测预填；
 * 入口B（药盒）恒无 planDraft / item / whitelist（结构上不含任何用法用量）。
 */
export interface DraftPayload {
  entry: Entry
  type: 'prescription' | 'drug'
  layers: LayerLabel[]
  /** 入口B 检测到医院标签层 → true（前端展示「标签用法不自动抄录」提示）。 */
  labelNotice?: boolean

  // ── 医嘱线（仅入口A）──
  /** 脱敏后的闭合白名单（L1+回链+L2）；降级时为 null。 */
  whitelist?: PrescriptionWhitelistType | null
  /** 人工补字段清单（该草稿相关；确认页显示原文空输入，绝不预填）。 */
  needsManual: string[]
  /** L2 脱敏审计（类型 → 次数，不含原文）。 */
  sanitizeAudit?: Record<string, number>
  /** L0 裁剪框几何（存档图仅存此框；前端按此叠加裁剪）。 */
  cropBox?: Box | null
  lowConfidenceChars?: LowConfidenceChar[]
  fallbackStatus?: 'not_needed' | 'success' | 'unavailable'
  backlinkIntercepted?: number
  /** 裁剪图存储引用（M2 仅存引用/几何，不存字节）。 */
  bodyImageRef?: string | null
  /** 本草稿对应的单条目（入口A N 拆 N）；降级时 null。 */
  item?: PrescriptionItem | null
  prescriptionNo?: string | null

  // ── 身份线 ──
  identity?: IdentityFields | null
  match?: MatchResult | null

  // ── 草稿 ──
  drugDraft: DrugDraft
  /** 计划草稿（含四类标注）；入口B 恒 null，入口A 无正文时 null。 */
  planDraft?: PlanDraft | null

  // ── 汇合 ──
  conflicts: DraftConflict[]
  healthSuggestions: HealthSuggestion[]
  interactions: InteractionResult
  dosageRange: DosageRangeResult
  degraded: Degraded | null
}
