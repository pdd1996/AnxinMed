/**
 * 队列摘要编排（T7.6 · ADR #17 第 3 条）——`runQueueSummary`。
 *
 * 与患者摘要（run.ts）同构：
 *   1. 组装 LLM prompt（分档统计 + 差档名单 + 事件计数，字段最小化）；
 *   2. 调 ai.queueSummary（Baichuan 生成队列叙述）；
 *   3. guardSummary 二次守门（L4/L3/L2/L1）；
 *   4. AIUnavailableError → fallbackQueueSummary 降级（规则拼装，不炸整体）。
 *
 * ⚠️ 编排纪律：
 * - 数字全部来自工具计算结果（listPatientsWithStats / listRiskEventsWindow），LLM 只做末端叙述；
 * - LLM 输出必过 guardSummary，绝不直通前端；
 * - ai.queueSummary 为可选方法：客户端未实现（如旧 mock/fixture 包）按 AIUnavailableError 降级。
 */
import { AIUnavailableError, type AiClients, type QueuePromptPayload } from '../../lib/ai/types.js'
import { fallbackQueueSummary } from './fallback-queue.js'
import { guardSummary } from './guards.js'
import type { InsightRunResult } from './types.js'

/** 队列工具链名称（ADR #17 语义化只读工具；供 snapshot.toolChain 展示）。 */
export const QUEUE_TOOL_CHAIN = ['adherence_distribution', 'patient_cohort', 'risk_event_rollup']

/** runQueueSummary 输入（service 层组装：分档统计 + 差档名单 + 事件计数 + env 开关）。 */
export interface QueueRunInput {
  payload: QueuePromptPayload
  /** 规则降级所需的分档计数（与 payload.grades 同源，避免降级时二次取数）。 */
  grades: QueuePromptPayload['grades']
  /** LLM 不可用时降级摘要里的 L4/L3 计数。 */
  riskEvents: QueuePromptPayload['riskEvents']
  /** AI 客户端注入接缝（M2-T1）；只需 queueSummary 一个方法，测试注入 mock。 */
  ai: Pick<AiClients, 'queueSummary'>
}

/** 队列摘要统一输出（复用患者摘要的 InsightRunResult 形态：sections + snapshot + citations）。 */
export type QueueRunResult = Pick<
  InsightRunResult,
  'riskLevel' | 'sections' | 'snapshot' | 'citations' | 'notice'
>

/** 队列摘要编排主入口（LLM 路径；AIUnavailableError 由调用方捕获转降级）。 */
export async function runQueueSummary(input: QueueRunInput): Promise<QueueRunResult> {
  const generatedAt = new Date().toISOString()
  try {
    if (!input.ai.queueSummary) {
      throw new AIUnavailableError('baichuan', 'AI 客户端未实现 queueSummary')
    }
    const raw = await input.ai.queueSummary(input.payload)
    const guarded = guardSummary(raw)
    return {
      riskLevel: guarded.riskLevel,
      sections: guarded.sections,
      snapshot: {
        generatedAt,
        dateRange: input.payload.dateRange,
        toolChain: QUEUE_TOOL_CHAIN,
        mode: 'llm',
      },
      citations: ['本地队列数据（演示数据，未经医学审核）'],
      notice: guarded.riskLevel === 'L2' ? '已过滤具体剂量建议。用量请按医生处方或说明书执行。' : undefined,
    }
  } catch (e) {
    if (e instanceof AIUnavailableError) {
      return finalizeFallback(input, generatedAt, 'error-fallback', `LLM 调用失败，已降级为规则摘要：${e.message}`)
    }
    throw e
  }
}

/** 离线降级路径（无 BAICHUAN_API_KEY 时）：规则拼装，不调 LLM。 */
export function runQueueSummaryOffline(input: Omit<QueueRunInput, 'ai'>): QueueRunResult {
  return finalizeFallback(input, new Date().toISOString(), 'offline-fallback', '未配置 BAICHUAN_API_KEY，摘要为规则降级生成。')
}

function finalizeFallback(
  input: Omit<QueueRunInput, 'ai'>,
  generatedAt: string,
  mode: 'offline-fallback' | 'error-fallback',
  notice: string,
): QueueRunResult {
  const fallback = fallbackQueueSummary(input.grades, input.riskEvents)
  const guarded = guardSummary(fallback)
  return {
    riskLevel: guarded.riskLevel,
    sections: guarded.sections,
    snapshot: { generatedAt, dateRange: input.payload.dateRange, toolChain: QUEUE_TOOL_CHAIN, mode },
    citations: ['本地队列数据（演示数据，未经医学审核）'],
    notice,
  }
}
