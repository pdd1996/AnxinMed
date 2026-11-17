/**
 * G10 可观测性 · 模型调用计数 + 日预算告警（进程内聚合 + 当日 JSON 原子落盘）。
 *
 * 埋点唯一收敛点：lib/ai/http.ts 的 callJson（所有模型调用的公共出口）——每次**尝试**记录
 * client / attempt / success|failure / retry / latencyMs；成功响应若带 usage 再累计
 * prompt_tokens / completion_tokens / prompt_tokens_details.cached_tokens（不记录任何模型输出内容）。
 *
 * 落盘：${LOG_DIR}/metrics-YYYY-MM-DD.json（原子写：临时文件 + rename）
 * - 每次更新后写当日文件；文件内容 = 各 client 累计 + budgetAlerts 阈值状态；
 * - 进程重启后首次读写时 load 当日文件恢复累计（日预算不因重启清零、告警不重复）；
 * - 跨日自动切到新一天文件（前一天文件已在每次更新时落盘，无需额外收尾）。
 *
 * 预算：累计 tokens → budget.ts 估算成本 → 达到 80%/100% 各 console.warn 一次
 * （`[obs:budget] {...spent/limit/percent...}`）；阈值状态随当日指标文件持久化。
 *
 * 失败语义：指标/落盘故障只 console.error，绝不向模型调用冒泡（观测不能打断业务）。
 */
import { existsSync, readFileSync } from 'node:fs'
import {
  BUDGET_OVER_PERCENT,
  BUDGET_WARN_PERCENT,
  budgetPercent,
  estimateCostCny,
  getBudgetConfig,
  roundCny,
  roundPercent,
  type TokenTotals,
} from './budget.js'
import { dateKey, logFilePath, writeJsonAtomic } from './io.js'

/** 单次模型尝试的埋点（callJson 调用）。 */
export interface ModelCallRecord {
  client: string
  /** 0 = 首次尝试；>0 = 重试。 */
  attempt: number
  success: boolean
  latencyMs: number
  usage?: TokenTotals | null
}

export interface ModelCallsSummaryClient {
  attempts: number
  success: number
  failure: number
  retries: number
  avgLatencyMs: number
  tokens: { prompt: number; completion: number; cached: number; total: number }
}

export interface ModelCallsSummary {
  byClient: Record<string, ModelCallsSummaryClient>
  totals: ModelCallsSummaryClient
}

interface ClientAgg {
  attempts: number
  success: number
  failure: number
  retries: number
  latencyMsSum: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
}

interface BudgetAlertState {
  warn: boolean
  over: boolean
}

interface MetricsState {
  day: string
  clients: Map<string, ClientAgg>
  budgetAlerts: BudgetAlertState
}

let state: MetricsState | null = null
/** 可注入时钟（日切/重启恢复单测用；生产恒为真实时间）。 */
let nowFn: () => Date = () => new Date()

/** 测试专用：注入时钟（传 null 恢复真实时间）。 */
export function setMetricsClockForTests(fn: (() => Date) | null): void {
  nowFn = fn ?? (() => new Date())
}

/** 测试专用：清空进程内状态（保留日志目录文件，用于模拟「重启后 load 当日文件」）。 */
export function resetMetricsForTests(): void {
  state = null
}

function emptyClient(): ClientAgg {
  return {
    attempts: 0,
    success: 0,
    failure: 0,
    retries: 0,
    latencyMsSum: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
  }
}

function emptyBudgetAlerts(): BudgetAlertState {
  return { warn: false, over: false }
}

function metricsFileName(day: string): string {
  return `metrics-${day}.json`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 宽松数值解析：非有限/负数 → 0（损坏文件不该让观测崩掉，但会打印可见错误）。 */
function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function parseClient(value: unknown): ClientAgg {
  const row = isRecord(value) ? value : {}
  return {
    attempts: readNumber(row.attempts),
    success: readNumber(row.success),
    failure: readNumber(row.failure),
    retries: readNumber(row.retries),
    latencyMsSum: readNumber(row.latencyMsSum),
    promptTokens: readNumber(row.promptTokens),
    completionTokens: readNumber(row.completionTokens),
    cachedTokens: readNumber(row.cachedTokens),
  }
}

/** 读取当日指标文件；不存在 → 空状态；损坏 → 可见报错后从零累计（不静默）。 */
function loadState(day: string): MetricsState {
  const fresh: MetricsState = { day, clients: new Map(), budgetAlerts: emptyBudgetAlerts() }
  const file = logFilePath(metricsFileName(day))
  if (!existsSync(file)) return fresh
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!isRecord(raw)) throw new Error('根节点不是对象')
    if (typeof raw.date === 'string' && raw.date !== day) {
      throw new Error(`文件日期 ${raw.date} 与加载日 ${day} 不一致`)
    }
    if (isRecord(raw.budgetAlerts)) {
      fresh.budgetAlerts = { warn: raw.budgetAlerts.warn === true, over: raw.budgetAlerts.over === true }
    }
    if (isRecord(raw.clients)) {
      for (const [name, agg] of Object.entries(raw.clients)) fresh.clients.set(name, parseClient(agg))
    }
    return fresh
  } catch (e) {
    console.error(
      `[obs:metrics] 当日指标文件损坏，已忽略并从零累计（${file}）：${e instanceof Error ? e.message : String(e)}`,
    )
    return { day, clients: new Map(), budgetAlerts: emptyBudgetAlerts() }
  }
}

/** 取（必要时切换/加载）当日状态。 */
function ensureState(now: Date = nowFn()): MetricsState {
  const day = dateKey(now)
  if (!state || state.day !== day) state = loadState(day)
  return state
}

function sumTokens(target: MetricsState): TokenTotals {
  let prompt = 0
  let completion = 0
  let cached = 0
  for (const agg of target.clients.values()) {
    prompt += agg.promptTokens
    completion += agg.completionTokens
    cached += agg.cachedTokens
  }
  return { prompt, completion, cached }
}

/** 预算阈值告警：80%/100% 各档每天只告警一次（状态存在当日指标文件里，重启不重复）。 */
function maybeWarnBudget(target: MetricsState): void {
  const tokens = sumTokens(target)
  if (tokens.prompt === 0 && tokens.completion === 0) return

  const config = getBudgetConfig()
  const spent = estimateCostCny(tokens, config.prices)
  const percent = roundPercent(budgetPercent(spent, config.limitCny))

  if (percent >= BUDGET_WARN_PERCENT && !target.budgetAlerts.warn) {
    target.budgetAlerts.warn = true
    console.warn(
      `[obs:budget] ${JSON.stringify({
        level: 'warn',
        threshold: BUDGET_WARN_PERCENT,
        spent: roundCny(spent),
        limit: config.limitCny,
        percent,
        date: target.day,
      })}`,
    )
  }
  if (percent >= BUDGET_OVER_PERCENT && !target.budgetAlerts.over) {
    target.budgetAlerts.over = true
    console.warn(
      `[obs:budget] ${JSON.stringify({
        level: 'over',
        threshold: BUDGET_OVER_PERCENT,
        spent: roundCny(spent),
        limit: config.limitCny,
        percent,
        date: target.day,
      })}`,
    )
  }
}

/** 原子写当日指标文件（失败 → 可见 console.error，不影响调用方）。 */
function persist(target: MetricsState): void {
  const clients: Record<string, ClientAgg> = {}
  for (const [name, agg] of target.clients) clients[name] = { ...agg }
  try {
    writeJsonAtomic(logFilePath(metricsFileName(target.day)), {
      date: target.day,
      clients,
      budgetAlerts: target.budgetAlerts,
    })
  } catch (e) {
    console.error(`[obs:metrics] 指标落盘失败（不影响模型调用）：${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * 记录一次模型调用尝试（callJson 唯一埋点入口；失败不冒泡）。
 * 注意：成功响应有 usage 才累计 token；失败尝试只计 attempts/failure/latency。
 */
export function recordModelCall(record: ModelCallRecord): void {
  try {
    const target = ensureState()
    const agg = target.clients.get(record.client) ?? emptyClient()
    agg.attempts += 1
    if (record.success) agg.success += 1
    else agg.failure += 1
    if (record.attempt > 0) agg.retries += 1
    const latency = Number(record.latencyMs)
    agg.latencyMsSum += Number.isFinite(latency) && latency > 0 ? latency : 0
    if (record.success && record.usage) {
      agg.promptTokens += Math.max(0, Math.floor(record.usage.prompt))
      agg.completionTokens += Math.max(0, Math.floor(record.usage.completion))
      agg.cachedTokens += Math.max(0, Math.floor(record.usage.cached))
    }
    target.clients.set(record.client, agg)
    maybeWarnBudget(target)
    persist(target)
  } catch (e) {
    console.error(`[obs:metrics] 记录模型调用失败（不影响业务）：${e instanceof Error ? e.message : String(e)}`)
  }
}

function toSummaryClient(agg: ClientAgg): ModelCallsSummaryClient {
  const tokens = {
    prompt: agg.promptTokens,
    completion: agg.completionTokens,
    cached: agg.cachedTokens,
    total: agg.promptTokens + agg.completionTokens,
  }
  return {
    attempts: agg.attempts,
    success: agg.success,
    failure: agg.failure,
    retries: agg.retries,
    avgLatencyMs: agg.attempts === 0 ? 0 : Math.round((agg.latencyMsSum / agg.attempts) * 10) / 10,
    tokens,
  }
}

/**
 * 当日的按 client 调用汇总（summary 用）。
 * 会先按当前时钟确保加载当日文件（重启后恢复累计；跨日自动切新文件）。
 */
export function getModelCallsSummary(now: Date = nowFn()): ModelCallsSummary {
  const emptyTotals: ModelCallsSummaryClient = toSummaryClient(emptyClient())
  try {
    const target = ensureState(now)
    const byClient: Record<string, ModelCallsSummaryClient> = {}
    const totals = emptyClient()
    for (const [name, agg] of target.clients) {
      byClient[name] = toSummaryClient(agg)
      totals.attempts += agg.attempts
      totals.success += agg.success
      totals.failure += agg.failure
      totals.retries += agg.retries
      totals.latencyMsSum += agg.latencyMsSum
      totals.promptTokens += agg.promptTokens
      totals.completionTokens += agg.completionTokens
      totals.cachedTokens += agg.cachedTokens
    }
    return { byClient, totals: toSummaryClient(totals) }
  } catch (e) {
    console.error(`[obs:metrics] 读取当日指标失败：${e instanceof Error ? e.message : String(e)}`)
    return { byClient: {}, totals: emptyTotals }
  }
}
