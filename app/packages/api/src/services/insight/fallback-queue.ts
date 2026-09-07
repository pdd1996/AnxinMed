/**
 * 队列摘要规则降级（T7.6）——`fallbackQueueSummary`。
 *
 * Baichuan 不可用（或 LLM 调用失败）时，用分档统计 + 事件计数拼装确定性摘要（不依赖 LLM）。
 * 与患者端 fallbackPatientSummary（fallback.ts）同构：纯函数、零 I/O；
 * riskLevel 由 guardSummary 二次守门决定。
 */
import type { QueuePromptPayload } from '../../lib/ai/types.js'
import type { RawSummarySections } from './guards.js'

/**
 * 规则降级队列摘要（纯函数，确定性）。
 * @param grades     分档计数（shared gradeAdherence 口径）
 * @param riskEvents 事件计数（窗口内 L4/L3 汇总）
 */
export function fallbackQueueSummary(
  grades: QueuePromptPayload['grades'],
  riskEvents: QueuePromptPayload['riskEvents'],
): RawSummarySections {
  const { good, fair, poor, ungraded } = grades
  const keyPoints: string[] = []
  const risks: string[] = []

  if (poor > 0) {
    keyPoints.push(`${poor} 名患者执行率差（<80%），建议优先随访`)
    risks.push('执行率差的患者漏服可能影响慢病控制效果')
  } else {
    keyPoints.push('队列内暂无执行率差（<80%）的患者')
  }
  if (ungraded > 0) {
    keyPoints.push(`${ungraded} 名患者近 30 天无打卡记录，无法分档`)
  }
  if (riskEvents.total > 0) {
    keyPoints.push(`近 30 天风险事件 ${riskEvents.total} 条（L4/L3/manual-gate）`)
  }
  if (riskEvents.hasL4) {
    risks.push('近期存在紧急风险信号（L4），请优先跟进对应患者')
  }

  return {
    summary: `队列共 ${good + fair + poor + ungraded} 名患者：执行率优 ${good} 人、中 ${fair} 人、差 ${poor} 人、无记录未分档 ${ungraded} 人。`,
    keyPoints: keyPoints.slice(0, 3),
    risks: risks.slice(0, 3),
    nextAction: '优先随访差档患者，诊间确认漏服原因；分档口径见数据快照。',
    warning: '本摘要基于患者自报数据，仅供参考，不构成诊疗或用药调整依据。',
  }
}
