/**
 * G10 单测：日预算口径（成本计算 / 80%·100% 单次告警 / 日切与重启恢复）。
 *
 * 通过临时 LOG_DIR 隔离落盘文件；metrics 的时钟用 setMetricsClockForTests 注入，
 * 不依赖真实日期与等待。console.warn 用 spy 捕获结构化告警行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BUDGET_OVER_PERCENT,
  BUDGET_WARN_PERCENT,
  budgetPercent,
  budgetStatus,
  estimateCostCny,
  getBudgetConfig,
  roundCny,
} from '../lib/observability/budget.js'
import { dateKey } from '../lib/observability/io.js'
import {
  getModelCallsSummary,
  recordModelCall,
  resetMetricsForTests,
  setMetricsClockForTests,
} from '../lib/observability/metrics.js'

const BUDGET_ENVS = [
  'LLM_DAILY_BUDGET_CNY',
  'LLM_PRICE_INPUT_CNY_PER_M',
  'LLM_PRICE_OUTPUT_CNY_PER_M',
  'LLM_PRICE_CACHED_CNY_PER_M',
] as const
const ORIGINAL_ENV = Object.fromEntries(BUDGET_ENVS.map((key) => [key, process.env[key]])) as Record<string, string | undefined>

let dir = ''
let clock = new Date(2026, 10, 18, 10, 0, 0)
let warnings: string[] = []

function clearBudgetEnv(): void {
  for (const key of BUDGET_ENVS) delete process.env[key]
}

function budgetLines(): Record<string, unknown>[] {
  return warnings
    .filter((line) => line.startsWith('[obs:budget] '))
    .map((line) => JSON.parse(line.slice('[obs:budget] '.length)) as Record<string, unknown>)
}

/** 打一次成功模型调用（只累计 usage，不碰网络）。 */
function recordUsage(prompt: number, completion = 0, cached = 0): void {
  recordModelCall({ client: 'qwen-text', attempt: 0, success: true, latencyMs: 10, usage: { prompt, completion, cached } })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anxin-obs-budget-'))
  process.env.LOG_DIR = dir
  clearBudgetEnv()
  resetMetricsForTests()
  clock = new Date(2026, 10, 18, 10, 0, 0)
  setMetricsClockForTests(() => clock)
  warnings = []
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  resetMetricsForTests()
  setMetricsClockForTests(null)
  delete process.env.LOG_DIR
  for (const key of BUDGET_ENVS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key]
    else process.env[key] = ORIGINAL_ENV[key]
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('成本计算（docs/11 §2.2 口径）', () => {
  it('未缓存输入×输入价 + 缓存命中×缓存价 + 输出×输出价（cached 是 prompt 子集，不重复计价）', () => {
    const prices = { inputCnyPerM: 0.8, outputCnyPerM: 2.7, cachedCnyPerM: 0.1 }
    // (600k×0.8 + 400k×0.1 + 100k×2.7) / 1M = (480000 + 40000 + 270000)/1M = 0.79
    const cost = estimateCostCny({ prompt: 1_000_000, completion: 100_000, cached: 400_000 }, prices)
    expect(cost).toBeCloseTo(0.79, 10)
    expect(roundCny(cost)).toBe(0.79)
  })

  it('缓存命中数超过 prompt 时按 prompt 封顶（防御脏 usage，不产生负成本）', () => {
    const prices = { inputCnyPerM: 1, outputCnyPerM: 1, cachedCnyPerM: 1 }
    expect(estimateCostCny({ prompt: 100, completion: 0, cached: 500 }, prices)).toBeCloseTo(0.0001, 10)
  })

  it('默认配置：日预算 ¥20、输入 ¥0.8/M、输出 ¥2.7/M、缓存 ¥0.1/M', () => {
    expect(getBudgetConfig()).toEqual({
      limitCny: 20,
      prices: { inputCnyPerM: 0.8, outputCnyPerM: 2.7, cachedCnyPerM: 0.1 },
    })
  })

  it('env 可覆盖；非法值回落默认并打印可见错误（不静默改行为）', () => {
    process.env.LLM_DAILY_BUDGET_CNY = '5'
    process.env.LLM_PRICE_INPUT_CNY_PER_M = '1.5'
    expect(getBudgetConfig()).toMatchObject({ limitCny: 5, prices: { inputCnyPerM: 1.5 } })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.LLM_DAILY_BUDGET_CNY = '-3'
    process.env.LLM_PRICE_OUTPUT_CNY_PER_M = 'not-a-number'
    const fallback = getBudgetConfig()
    expect(fallback.limitCny).toBe(20)
    expect(fallback.prices.outputCnyPerM).toBe(2.7)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('百分比与状态：<80 ok、>=80 warn、>=100 over', () => {
    expect(budgetStatus(0)).toBe('ok')
    expect(budgetStatus(79.99)).toBe('ok')
    expect(budgetStatus(BUDGET_WARN_PERCENT)).toBe('warn')
    expect(budgetStatus(99.99)).toBe('warn')
    expect(budgetStatus(BUDGET_OVER_PERCENT)).toBe('over')
    expect(budgetPercent(0.8, 1)).toBeCloseTo(80, 10)
  })
})

describe('80% / 100% 告警（每档每天只触发一次）', () => {
  it('先 80% 一次、再 100% 一次，之后不再重复；告警行含 spent/limit/percent', () => {
    process.env.LLM_DAILY_BUDGET_CNY = '1'
    process.env.LLM_PRICE_INPUT_CNY_PER_M = '1'

    const startLines = budgetLines()
    recordUsage(800_000) // 800k × ¥1/M = ¥0.8 = 80%
    expect(startLines).toHaveLength(0)
    let budgetWarnings = budgetLines()
    expect(budgetWarnings).toHaveLength(1)
    expect(budgetWarnings[0]).toMatchObject({ level: 'warn', threshold: 80 })
    expect(Number(budgetWarnings[0].spent)).toBeCloseTo(0.8, 6)
    expect(budgetWarnings[0].limit).toBe(1)
    expect(Number(budgetWarnings[0].percent)).toBeCloseTo(80, 2)

    recordUsage(100_000) // 累计 ¥0.9 = 90% → warn 已发，不重复
    expect(budgetLines()).toHaveLength(1)

    recordUsage(200_000) // 累计 ¥1.1 = 110% → over 一次
    budgetWarnings = budgetLines()
    expect(budgetWarnings).toHaveLength(2)
    expect(budgetWarnings[1]).toMatchObject({ level: 'over', threshold: 100, limit: 1 })
    expect(Number(budgetWarnings[1].percent)).toBeCloseTo(110, 2)

    recordUsage(500_000) // 继续超限 → 两档都不再重复
    expect(budgetLines()).toHaveLength(2)
  })

  it('重启不重复告警（阈值状态随当日 metrics-*.json 持久化）', () => {
    process.env.LLM_DAILY_BUDGET_CNY = '1'
    process.env.LLM_PRICE_INPUT_CNY_PER_M = '1'

    recordUsage(800_000)
    expect(budgetLines()).toHaveLength(1)

    resetMetricsForTests() // 模拟进程重启：内存清空，当日文件保留
    recordUsage(10_000) // 仍 >80%，应加载文件里的 alert 状态 → 不再告警
    expect(budgetLines()).toHaveLength(1)
    expect(getModelCallsSummary().totals.tokens.prompt).toBe(810_000) // 累计也未清零
  })
})

describe('日切与按日落盘', () => {
  it('跨日从零累计、按日落盘；昨日文件保留', () => {
    process.env.LLM_DAILY_BUDGET_CNY = '1'
    process.env.LLM_PRICE_INPUT_CNY_PER_M = '1'

    recordUsage(800_000)
    expect(budgetLines()).toHaveLength(1)
    expect(existsSync(join(dir, `metrics-${dateKey(clock)}.json`))).toBe(true)
    const day1 = dateKey(clock)

    clock = new Date(2026, 10, 19, 10, 0, 0) // 次日
    recordUsage(1000)
    const summary = getModelCallsSummary()
    expect(summary.totals.tokens.prompt).toBe(1000) // 新的一天从零累计
    expect(summary.totals.attempts).toBe(1)
    expect(existsSync(join(dir, `metrics-${dateKey(clock)}.json`))).toBe(true)
    expect(existsSync(join(dir, `metrics-${day1}.json`))).toBe(true)

    // 次日再次越过 80% 阈值 → 允许再次告警（每档每天一次，按日重置）
    recordUsage(800_000)
    expect(budgetLines()).toHaveLength(2)
  })
})
