/**
 * 医生端摘要规则降级（M3-T3 · PRD §7.7）——`fallbackPatientSummary`。
 *
 * 照搬 demo/server/index.js:1252-1284 的实测逻辑：
 * Baichuan 不可用（或 LLM 调用失败）时，用 5 个只读工具的输出拼装确定性摘要（不依赖 LLM）。
 *
 * ⚠️ 降级路径的 riskLevel 由 guardSummary 二次守门决定（fallback 产物也可能命中 L4/L3/L2）。
 */
import type { PatientListItem } from '../../repositories/insight.repo.js'
import type { InsightTools } from './types.js'
import type { RawSummarySections } from './guards.js'

/**
 * 规则降级摘要（纯函数，零 I/O，确定性）。
 * @param patient 患者信息（name/age/gender/conditions）
 * @param tools   5 个只读工具的聚合产物
 * @returns RawSummarySections（供 guardSummary 二次守门）
 */
export function fallbackPatientSummary(
  patient: PatientListItem,
  tools: InsightTools,
): RawSummarySections {
  const { adherence, interactions, expiry, riskEvents } = tools
  const keyPoints: string[] = []
  const risks: string[] = []

  keyPoints.push(
    `近 ${adherence.dateRange} 天整体服药执行率 ${adherence.rate}%（已服 ${adherence.taken}/${adherence.total} 次）`,
  )
  if (adherence.consecutiveSkip > 0) {
    keyPoints.push(`连续漏服 ${adherence.consecutiveSkip} 次，建议诊间询问漏服原因`)
    risks.push('连续漏服可能影响慢病控制效果')
  }
  if (interactions.hasInteraction) {
    keyPoints.push(`存在 ${interactions.items.length} 项药物相互作用提示`)
    risks.push(interactions.items[0]?.note || '部分药品联用需关注')
  }
  if (expiry.expiring.length > 0) {
    keyPoints.push(`${expiry.expiring.length} 种药品临期（≤30 天）`)
    risks.push('临期药品需确认是否继续使用')
  }
  if (riskEvents.hasL4) {
    risks.push('近期命中过紧急风险关键词，已引导急救')
  }
  if (riskEvents.blockedCount > 0) {
    keyPoints.push(`咨询中被安全规则拦截 ${riskEvents.blockedCount} 次（多为停换药疑问）`)
  }

  const patientName = patient.name ?? '患者'
  const ageStr = patient.age ? `${patient.age} 岁，` : ''
  const genderStr = patient.gender ? `${patient.gender}，` : ''
  const conditionsStr = patient.conditions.length > 0 ? `慢病：${patient.conditions.join('、')}。` : ''
  const adherenceStr = adherence.consecutiveSkip > 0
    ? `连续漏服 ${adherence.consecutiveSkip} 次`
    : '无明显连续漏服'
  const interactionStr = interactions.hasInteraction ? '存在药物相互作用提示' : '未见明确相互作用'

  return {
    summary: `患者 ${patientName}（${ageStr}${genderStr}${conditionsStr}）近 ${adherence.dateRange} 天服药执行率 ${adherence.rate}%，${adherenceStr}，${interactionStr}。`,
    keyPoints: keyPoints.slice(0, 3),
    risks: risks.slice(0, 3),
    nextAction: '依处方判断是否需要调整，并向患者确认漏服原因与近期不适。',
    warning: '本摘要基于患者自报数据，仅供参考，不构成诊疗或用药调整依据。',
  }
}
