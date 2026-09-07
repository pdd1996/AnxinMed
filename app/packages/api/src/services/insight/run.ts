/**
 * 医生端洞察编排（M3-T3 · PRD §7.7）——`runInsightSummary`。
 *
 * 分派逻辑：
 *   1. 组装 LLM prompt（5 个只读工具输出 + 患者信息 + 数据区间）；
 *   2. 调 ai.insightSummary（Baichuan 生成摘要）；
 *   3. guardSummary 二次守门（L4/L3/L2/L1）；
 *   4. AIUnavailableError → fallbackPatientSummary 降级（规则拼装，不炸整体）。
 *
 * ⚠️ 编排纪律：
 * - 守门为纯函数产物（guards.ts），本层只做分派与 I/O 编排；
 * - LLM 输出必过 guardSummary（stripDosageAdvice + L4/L3 固定文案），绝不直通前端；
 * - AIUnavailableError 不炸整体：转 fallbackPatientSummary（Baichuan 不可用 → 规则拼装）。
 */
import { AIUnavailableError } from '../../lib/ai/types.js'
import { fallbackPatientSummary } from './fallback.js'
import { guardSummary } from './guards.js'
import type { InsightRunInput, InsightRunResult } from './types.js'

/** 工具链名称（照搬 demo:1319，供 snapshot.toolChain 展示）。 */
const TOOL_CHAIN = [
  'getAdherence',
  'getMedicationList',
  'checkInteractions',
  'checkExpiryStock',
  'getRiskEvents',
]

/**
 * 医生端摘要编排主入口。
 * @returns InsightRunResult 统一形态，路由层直接返回给前端。
 */
export async function runInsightSummary(input: InsightRunInput): Promise<InsightRunResult> {
  const { patient, tools, dateRange, ai } = input
  const generatedAt = new Date().toISOString()
  const citations = ['本地患者数据（演示数据，未经医学审核）']

  // ── 1. 调 Baichuan 生成摘要（AIUnavailableError → 降级）──
  try {
    const raw = await ai.insightSummary({
      patient: {
        name: patient.name ?? '患者',
        age: patient.age,
        gender: patient.gender,
        conditions: patient.conditions,
      },
      dateRange,
      tools: {
        adherence: {
          rate: tools.adherence.rate,
          taken: tools.adherence.taken,
          total: tools.adherence.total,
          consecutiveSkip: tools.adherence.consecutiveSkip,
          skipDetails: tools.adherence.skipDetails.map((s) => s.date),
        },
        medicationCount: tools.medicationList.length,
        medicationNames: tools.medicationList.map((m) => m.genericName),
        interactions: tools.interactions.hasInteraction
          ? tools.interactions.items.map((i) => `${i.level}：${i.note}`)
          : [],
        expiry: {
          expiringCount: tools.expiry.expiring.length,
          expiredCount: tools.expiry.expired.length,
          lowStockCount: tools.expiry.lowStock.length,
        },
        riskEvents: {
          hasL4: tools.riskEvents.hasL4,
          hasL3: tools.riskEvents.hasL3,
          blockedCount: tools.riskEvents.blockedCount,
          lastQuestion: tools.riskEvents.lastQuestion,
        },
      },
      question: input.question,
    })

    // ── 2. guardSummary 二次守门（L4/L3/L2/L1）──
    const guarded = guardSummary(raw)

    return {
      patient,
      riskLevel: guarded.riskLevel,
      sections: guarded.sections,
      tools,
      snapshot: { generatedAt, dateRange, toolChain: TOOL_CHAIN, mode: 'llm' },
      citations,
      notice: guarded.riskLevel === 'L2' ? '已过滤具体剂量建议。用量请按医生处方或说明书执行。' : undefined,
    }
  } catch (e) {
    // ── 3. AIUnavailableError → fallbackPatientSummary 降级（不炸整体）──
    if (e instanceof AIUnavailableError) {
      const fallback = fallbackPatientSummary(patient, tools)
      const guarded = guardSummary(fallback)
      return {
        patient,
        riskLevel: guarded.riskLevel,
        sections: guarded.sections,
        tools,
        snapshot: { generatedAt, dateRange, toolChain: TOOL_CHAIN, mode: 'error-fallback' },
        citations,
        notice: `LLM 调用失败，已降级为规则摘要：${e.message}`,
      }
    }
    throw e
  }
}

/**
 * 离线降级路径（无 BAICHUAN_API_KEY 时）：直接用规则拼装，不调 LLM。
 * 与 demo:1331-1345 等价；snapshot.mode='offline-fallback'。
 */
export function runInsightSummaryOffline(input: Omit<InsightRunInput, 'ai'>): InsightRunResult {
  const { patient, tools, dateRange } = input
  const generatedAt = new Date().toISOString()
  const fallback = fallbackPatientSummary(patient, tools)
  const guarded = guardSummary(fallback)
  return {
    patient,
    riskLevel: guarded.riskLevel,
    sections: guarded.sections,
    tools,
    snapshot: { generatedAt, dateRange, toolChain: TOOL_CHAIN, mode: 'offline-fallback' },
    citations: ['本地患者数据（演示数据，未经医学审核）'],
    notice: '未配置 BAICHUAN_API_KEY，摘要为规则降级生成。',
  }
}
