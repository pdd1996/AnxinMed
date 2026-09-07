/**
 * 队列问答模板（T7 ask data 路径）——队列工具结果 → NormalizedSections 确定性渲染。
 *
 * 与 consult/dataquery.ts 模板同纪律：
 * - 模板直接产出 sections，**不经** normalizeSections/stripDosageAdvice：统计数字
 *   （如「执行率 60%」「3 人」）不会被 L2 剂量正则误杀；模板自身禁止出现剂量/用法表述，
 *   只陈述统计事实与分档口径。
 * - 空数据给友好固定文案；数字全部来自工具计算结果（LLM 不做分类器，ADR #17 第 3 条）。
 */
import type { NormalizedSections } from '../consult/types.js'
import type { AdherenceDistributionResult, PatientCohortResult, RiskEventRollupResult } from './tools.js'

/** 队列问答统一安全语（模板路径 warning；不含剂量/用法表述）。 */
const QUEUE_ASK_WARNING = '以上为队列统计事实，仅供诊前参考，不构成诊疗或用药调整依据。'

/** adherence-distribution 模板：分档分布 + 直方图数据。 */
export function renderAdherenceDistributionSections(result: AdherenceDistributionResult): NormalizedSections {
  const { grades, total } = result
  if (total === 0) {
    return {
      summary: '队列中暂无患者数据。',
      keyPoints: ['可在「设置」导入演示数据，或先为患者建档。'],
      risks: [],
      nextAction: '建档并产生服药打卡后，这里会出现分档统计。',
      warning: QUEUE_ASK_WARNING,
      limited: false,
    }
  }
  const keyPoints = [
    `执行率优（≥95%）${grades.good} 人`,
    `执行率中（80–94%）${grades.fair} 人`,
    `执行率差（<80%）${grades.poor} 人`,
  ]
  if (grades.ungraded > 0) {
    keyPoints.push(`近 30 天无打卡记录、无法分档 ${grades.ungraded} 人`)
  }
  const risks: string[] = []
  if (grades.poor > 0) {
    risks.push(`${grades.poor} 名患者执行率差，漏服可能影响慢病控制效果`)
  }
  return {
    summary: `队列共 ${total} 名患者：优 ${grades.good} 人、中 ${grades.fair} 人、差 ${grades.poor} 人${grades.ungraded > 0 ? `、未分档 ${grades.ungraded} 人` : ''}（近 ${result.days} 天）。`,
    keyPoints,
    risks,
    nextAction: '建议优先随访差档患者，诊间确认漏服原因。',
    warning: QUEUE_ASK_WARNING,
    limited: false,
  }
}

/** poor-cohort 模板：差档患者名单（点名为显式下钻动作）。 */
export function renderPatientCohortSections(result: PatientCohortResult): NormalizedSections {
  if (result.count === 0) {
    return {
      summary: `近 ${result.days} 天执行率「${result.gradeLabel}」档的患者为 0 人。`,
      keyPoints: ['分档口径：执行率优 ≥95% / 中 80–94% / 差 <80%。'],
      risks: [],
      nextAction: '可在队列视图查看全体患者的分档分布。',
      warning: QUEUE_ASK_WARNING,
      limited: false,
    }
  }
  const keyPoints = result.patients
    .slice(0, 10)
    .map(
      (p) =>
        `${p.name ?? '未命名'}：执行率 ${p.adherenceRate != null ? `${p.adherenceRate}%` : '无记录'}${p.conditions.length > 0 ? `（${p.conditions.join('、')}）` : ''}`,
    )
  if (result.count > 10) {
    keyPoints.push(`……及其他 ${result.count - 10} 名患者`)
  }
  return {
    summary: `近 ${result.days} 天执行率「${result.gradeLabel}」档共 ${result.count} 人。`,
    keyPoints,
    risks:
      result.grade === 'poor'
        ? ['执行率差的患者漏服可能影响疗效，建议诊间询问漏服原因']
        : [],
    nextAction: '点击患者行可生成诊前摘要，下钻查看依从性明细。',
    warning: QUEUE_ASK_WARNING,
    limited: false,
  }
}

/** risk-events 模板：事件聚合时间线（只陈述事实，不给处置建议）。 */
export function renderRiskEventRollupSections(result: RiskEventRollupResult): NormalizedSections {
  if (result.total === 0) {
    return {
      summary: `近 ${result.days} 天全体患者无风险拦截事件（L4/L3/manual-gate）。`,
      keyPoints: ['风险事件由咨询守门自动留痕：L4 紧急信号 / L3 拒答 / manual-gate 人工档拦截。'],
      risks: [],
      nextAction: '患者触发守门拦截时会自动出现在这里。',
      warning: QUEUE_ASK_WARNING,
      limited: false,
    }
  }
  const keyPoints = result.timeline
    .slice(-10)
    .reverse() // 最新在前
    .map((t) => `${t.date} ${t.level} × ${t.count}`)
  const hasL4 = result.timeline.some((t) => t.level === 'L4')
  return {
    summary: `近 ${result.days} 天风险事件共 ${result.total} 条。`,
    keyPoints,
    risks: hasL4 ? ['存在 L4 紧急信号事件，请确认对应患者已得到处置'] : [],
    nextAction: '点击对应患者行可下钻查看风险事件明细与咨询留痕。',
    warning: QUEUE_ASK_WARNING,
    limited: false,
  }
}
