/**
 * G10 可观测性 · summary 组装（GET /api/observability/summary 的唯一数据源）。
 *
 * 输出（ok:true + data）：
 *   date / modelCalls{byClient,totals} / estimatedCostCny /
 *   budget{limitCny,spentCny,percent,status} / rateLimited / errors / uptimeSec / version
 * 全部为聚合数值，**无 PII、无请求体、无模型输出**。
 */
import { API_VERSION } from '../version.js'
import {
  budgetPercent,
  budgetStatus,
  estimateCostCny,
  getBudgetConfig,
  roundCny,
  roundPercent,
  type BudgetStatus,
} from './budget.js'
import { getTodayErrorCount } from './error-log.js'
import { dateKey } from './io.js'
import { getModelCallsSummary, type ModelCallsSummary } from './metrics.js'
import { getRateLimitedCount } from './rate-limit.js'

export interface ObservabilitySummary {
  date: string
  modelCalls: ModelCallsSummary
  estimatedCostCny: number
  budget: {
    limitCny: number
    spentCny: number
    percent: number
    status: BudgetStatus
  }
  rateLimited: number
  errors: number
  uptimeSec: number
  version: string
}

/** 组装当日可观测性快照（纯聚合读，不落盘、不触发告警）。 */
export function getObservabilitySummary(now: Date = new Date()): ObservabilitySummary {
  const calls = getModelCallsSummary(now)
  const config = getBudgetConfig()
  const spentCny = estimateCostCny(calls.totals.tokens, config.prices)
  const percent = budgetPercent(spentCny, config.limitCny)

  return {
    date: dateKey(now),
    modelCalls: calls,
    estimatedCostCny: roundCny(spentCny),
    budget: {
      limitCny: config.limitCny,
      spentCny: roundCny(spentCny),
      percent: roundPercent(percent),
      status: budgetStatus(percent),
    },
    rateLimited: getRateLimitedCount(now),
    errors: getTodayErrorCount(now),
    uptimeSec: Math.round(process.uptime()),
    version: API_VERSION,
  }
}
