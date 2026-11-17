/**
 * G10 可观测性 · 日模型预算（纯函数 + env 口径）。
 *
 * 口径（docs/11 §2.2 同源）：
 * - 成本 = 未缓存输入 tokens × 输入价 + 缓存命中 tokens × 缓存价 + 输出 tokens × 输出价；
 *   缓存命中是 prompt_tokens 的子集（百炼 usage.prompt_tokens_details.cached_tokens），不得重复计价。
 * - 单价默认按百炼价目：输入 ¥0.8/M、输出 ¥2.7/M、缓存命中 ¥0.1/M；日预算默认 ¥20（CNY）。
 * - 环境变量：LLM_DAILY_BUDGET_CNY / LLM_PRICE_INPUT_CNY_PER_M /
 *   LLM_PRICE_OUTPUT_CNY_PER_M / LLM_PRICE_CACHED_CNY_PER_M。
 *
 * 本文件只做「读配置 + 估算 + 阈值判定」；累计与告警去重状态在 metrics.ts（随当日指标文件持久化，
 * 重启不重复告警、预算不因重启清零）。
 */

/** tokens 汇总口径：cached 是 prompt 的子集，total = prompt + completion（与 docs/11 §2.2 一致）。 */
export interface TokenTotals {
  prompt: number
  completion: number
  cached: number
}

/** 三项单价（CNY / 百万 tokens）。 */
export interface BudgetPrices {
  inputCnyPerM: number
  outputCnyPerM: number
  cachedCnyPerM: number
}

export interface BudgetConfig {
  limitCny: number
  prices: BudgetPrices
}

export type BudgetStatus = 'ok' | 'warn' | 'over'

export const BUDGET_WARN_PERCENT = 80
export const BUDGET_OVER_PERCENT = 100

/** 内置默认值（env 缺省/非法时回落到这里；非法值会 console.error 可见）。 */
const DEFAULTS = {
  limitCny: 20,
  inputCnyPerM: 0.8,
  outputCnyPerM: 2.7,
  cachedCnyPerM: 0.1,
} as const

/** 读正数 env：缺省/空 → 默认；非法（NaN/负数/0）→ 默认并打印可见告警（不静默改行为）。 */
function readPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`[obs:budget] 环境变量 ${name} 非法（${raw}），回落默认值 ${fallback}`)
    return fallback
  }
  return n
}

/** 当前预算配置（每请求读 env，便于测试/运维改参数即时生效）。 */
export function getBudgetConfig(): BudgetConfig {
  return {
    limitCny: readPositiveNumber('LLM_DAILY_BUDGET_CNY', DEFAULTS.limitCny),
    prices: {
      inputCnyPerM: readPositiveNumber('LLM_PRICE_INPUT_CNY_PER_M', DEFAULTS.inputCnyPerM),
      outputCnyPerM: readPositiveNumber('LLM_PRICE_OUTPUT_CNY_PER_M', DEFAULTS.outputCnyPerM),
      cachedCnyPerM: readPositiveNumber('LLM_PRICE_CACHED_CNY_PER_M', DEFAULTS.cachedCnyPerM),
    },
  }
}

/**
 * 当日 tokens → 估算成本（CNY）。
 * cached 按 prompt_tokens 封顶（防御上游把缓存命中报成超过输入总量的脏数据）。
 */
export function estimateCostCny(tokens: TokenTotals, prices: BudgetPrices = getBudgetConfig().prices): number {
  const cached = Math.min(Math.max(0, tokens.cached), Math.max(0, tokens.prompt))
  const uncached = Math.max(0, tokens.prompt) - cached
  return (
    (uncached * prices.inputCnyPerM + cached * prices.cachedCnyPerM + Math.max(0, tokens.completion) * prices.outputCnyPerM) /
    1_000_000
  )
}

/** 预算使用百分比（limit > 0 由配置层保证；防御性给 0 上限为 100）。 */
export function budgetPercent(spentCny: number, limitCny: number): number {
  if (!Number.isFinite(limitCny) || limitCny <= 0) return spentCny > 0 ? BUDGET_OVER_PERCENT : 0
  return (spentCny / limitCny) * 100
}

/** 预算状态：<80% ok；>=80% warn；>=100% over（summary 展示用；告警一次由 metrics 持久化状态保证）。 */
export function budgetStatus(percent: number): BudgetStatus {
  if (percent >= BUDGET_OVER_PERCENT) return 'over'
  if (percent >= BUDGET_WARN_PERCENT) return 'warn'
  return 'ok'
}

/** 金额展示：保留 4 位小数（分以下精度足够估算口径；账单以控制台账单为准）。 */
export function roundCny(value: number): number {
  return Math.round(value * 1e4) / 1e4
}

/** 百分比展示：保留 2 位小数（阈值比较也用舍入后的值，规避浮点边界误判）。 */
export function roundPercent(value: number): number {
  return Math.round(value * 100) / 100
}
