/**
 * 管线打点计时（M3-T5 · spec §T5.1）——轻量 Stopwatch + 百分位统计（P50/P95）。
 *
 * 纯工具、无副作用（仅读 performance.now），可独立单测；供 pipeline/run.ts 逐步打点、
 * intake.service 汇总结构化日志、scripts/perf-intake.ts 聚合实测样本。
 *
 * 设计：阶段耗时按名累加（同名多次自动求和，如 N 条目装配）；总耗时为墙钟（含并行重叠，
 * 故各阶段之和可能 > total——身份线与医嘱线并行，属预期，日志据此判断瓶颈）。
 */

/** 一次管线运行的计时汇总：总墙钟 + 各命名阶段耗时（ms，保留 1 位小数）。 */
export interface TimingSummary {
  totalMs: number
  phases: Record<string, number>
}

/** 一组样本的百分位汇总（P50/P95），按 total 与各阶段分别统计。 */
export interface TimingPercentiles {
  count: number
  total: { p50: number; p95: number }
  phases: Record<string, { p50: number; p95: number }>
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** 秒表：创建即开始计时；measureSync/measureAsync 包裹阶段，record 手动记，summarize 汇总。 */
export class Stopwatch {
  private readonly t0: number
  private readonly phases: Record<string, number> = {}

  constructor() {
    this.t0 = performance.now()
  }

  /** 记录一个阶段耗时（ms，累加）。 */
  record(name: string, ms: number): void {
    this.phases[name] = (this.phases[name] ?? 0) + ms
  }

  /** 包裹同步函数并计时，返回其结果。 */
  measureSync<T>(name: string, fn: () => T): T {
    const s = performance.now()
    try {
      return fn()
    } finally {
      this.record(name, performance.now() - s)
    }
  }

  /** 包裹异步函数并计时，返回其结果（异常也会记时，便于观测失败步骤耗时）。 */
  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const s = performance.now()
    try {
      return await fn()
    } finally {
      this.record(name, performance.now() - s)
    }
  }

  /** 自创建起的墙钟耗时（ms）。 */
  elapsed(): number {
    return performance.now() - this.t0
  }

  /** 汇总：总墙钟 + 各阶段（保留 1 位小数，日志友好）。 */
  summarize(): TimingSummary {
    const phases: Record<string, number> = {}
    for (const [name, ms] of Object.entries(this.phases)) phases[name] = round1(ms)
    return { totalMs: round1(this.elapsed()), phases }
  }
}

/**
 * 百分位（线性插值，nearest-rank 的连续版）。samples 无需预排序；空数组返回 0。
 * p ∈ [0,100]；p50=中位数，p95=95 分位。单样本直接返回该值。
 */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  if (sorted.length === 1) return round1(sorted[0] as number)
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  const loVal = sorted[lo] as number
  if (lo === hi) return round1(loVal)
  const hiVal = sorted[hi] as number
  return round1(loVal + (hiVal - loVal) * (rank - lo))
}

/** 聚合多次运行的计时样本 → total 与各阶段的 P50/P95（性能报告用）。 */
export function aggregateTimings(samples: TimingSummary[]): TimingPercentiles {
  const totals = samples.map((s) => s.totalMs)
  const phaseNames = new Set<string>()
  for (const s of samples) for (const name of Object.keys(s.phases)) phaseNames.add(name)
  const phases: Record<string, { p50: number; p95: number }> = {}
  for (const name of phaseNames) {
    const vals = samples.map((s) => s.phases[name] ?? 0)
    phases[name] = { p50: percentile(vals, 50), p95: percentile(vals, 95) }
  }
  return {
    count: samples.length,
    total: { p50: percentile(totals, 50), p95: percentile(totals, 95) },
    phases,
  }
}
