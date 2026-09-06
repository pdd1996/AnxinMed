/**
 * 医生端摘要二次守门（M3-T3 · PRD §7.7）——`guardSummary`。
 *
 * 照搬 demo/server/index.js:1194-1250 的实测逻辑，复用 M3-T1 的 patterns.ts + sanitize.ts：
 *   1. 合并 summary + keyPoints + nextAction 为 combined 文本；
 *   2. L4 emergency：combined 命中紧急关键词 → 固定文案（引导联系患者/急诊）；
 *   3. L3 refused：combined 命中停/换药/剂量调整 → 固定文案（拒答 + 引导开方医生）；
 *   4. L2 limited：stripDosageAdvice 过滤后仍残留剂量模式 → 固定文案（已过滤具体剂量建议）；
 *   5. L1 normal：干净输出 → 原样返回（sanitizeText 清洗 Markdown/引用编号）。
 *
 * ⚠️ 与咨询守门（services/consult/guards.ts）的差异：
 * - 咨询守门检测**用户提问**（输入侧），摘要守门检测**LLM 输出**（输出侧）；
 * - 咨询 L4/L3 触发 risk_events 留痕，摘要 L4/L3 仅改 sections（医生端看的是聚合结果，不留痕）。
 */
import { EMERGENCY_PATTERN, PROHIBITED_PATTERN } from '../consult/patterns.js'
import { containsDosageAdvice, sanitizeText, stripDosageAdvice } from '../consult/sanitize.js'
import type { GuardedSummary } from './types.js'

/** LLM 输出的原始分区（与 ConsultRawSections 同构；全字段可选）。 */
export interface RawSummarySections {
  summary?: string
  keyPoints?: string[]
  risks?: string[]
  nextAction?: string
  warning?: string
}

/**
 * 摘要二次守门（纯函数，零 I/O，确定性）。
 * @param sections LLM 输出（或 fallback 产物）
 * @returns GuardedSummary（riskLevel + 守门后的 sections）
 */
export function guardSummary(sections: RawSummarySections | null): GuardedSummary {
  const summary = sections?.summary ?? ''
  const keyPoints = Array.isArray(sections?.keyPoints) ? sections.keyPoints : []
  const nextAction = sections?.nextAction ?? ''
  const combined = [summary, ...keyPoints, nextAction].join(' ')

  // ── L4 紧急信号 ──
  if (EMERGENCY_PATTERN.test(combined)) {
    return {
      riskLevel: 'L4',
      sections: {
        summary: '摘要涉及紧急风险信号，建议立即联系患者或引导就医。',
        keyPoints: ['该患者近期可能存在需要紧急处理的情况'],
        risks: ['不要等待 AI 继续判断'],
        nextAction: '请立即联系患者或引导其前往急诊。',
        warning: '紧急情况下，AI 不能替代急救或专业医疗评估。',
      },
    }
  }

  // ── L3 拒答 ──
  if (PROHIBITED_PATTERN.test(combined)) {
    return {
      riskLevel: 'L3',
      sections: {
        summary: '摘要已被安全守门拦截：不得建议自行增减剂量、停药或换药。',
        keyPoints: ['用药调整需结合诊断与检查结果，由开方医生判断'],
        risks: ['自行调整可能导致治疗失败或不良反应'],
        nextAction: '请结合处方与患者实际情况判断，必要时联系开方医生。',
        warning: '不要根据 AI 摘要自行调整处方。',
      },
    }
  }

  // ── L2 剂量过滤 ──
  const cleanedSummary = stripDosageAdvice(summary)
  const cleanedKeyPoints = keyPoints.map((s) => stripDosageAdvice(s)).filter(Boolean)
  const cleanedNext = stripDosageAdvice(nextAction)
  const limited = [cleanedSummary, ...cleanedKeyPoints, cleanedNext].some(containsDosageAdvice)

  if (limited) {
    return {
      riskLevel: 'L2',
      sections: {
        summary: cleanedSummary || '已过滤具体剂量建议。用量请按处方或说明书执行。',
        keyPoints: cleanedKeyPoints.length ? cleanedKeyPoints : ['具体用量请按医生处方执行'],
        risks: Array.isArray(sections?.risks) ? sections.risks.slice(0, 3) : [],
        nextAction: '具体用量和疗程请按医生处方或说明书执行。',
        warning: sections?.warning || '不要根据 AI 摘要自行调整处方。',
      },
    }
  }

  // ── L1 正常 ──
  return {
    riskLevel: 'L1',
    sections: {
      summary: cleanedSummary,
      keyPoints: cleanedKeyPoints,
      risks: Array.isArray(sections?.risks)
        ? sections.risks.slice(0, 3).map((s) => sanitizeText(s)).filter(Boolean)
        : [],
      nextAction: cleanedNext || '如有疑问，请咨询医生或药师。',
      warning: sections?.warning || '不要根据 AI 摘要自行调整处方。',
    },
  }
}
