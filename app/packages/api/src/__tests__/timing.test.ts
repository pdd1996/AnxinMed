/**
 * M3-T5 · timing 纯工具单测（spec §T5.1）：Stopwatch 阶段计时 + percentile(P50/P95) + aggregateTimings。
 * 百分位用确定性数组断言；Stopwatch 用一次 5ms 延迟证明测的是真实耗时（留松弛避免抖动）。
 */
import { describe, it, expect } from 'vitest'
import { Stopwatch, percentile, aggregateTimings, type TimingSummary } from '../lib/timing.js'

describe('Stopwatch', () => {
  it('measureSync 返回原值并记录该阶段（>=0）', () => {
    const sw = new Stopwatch()
    const out = sw.measureSync('crop', () => 42)
    expect(out).toBe(42)
    const s = sw.summarize()
    expect(typeof s.phases.crop).toBe('number')
    expect(s.phases.crop).toBeGreaterThanOrEqual(0)
    expect(s.totalMs).toBeGreaterThanOrEqual(0)
  })

  it('measureAsync 测到真实耗时（5ms 延迟 → >=3ms）并返回原值', async () => {
    const sw = new Stopwatch()
    const out = await sw.measureAsync('ocr', async () => {
      await new Promise((r) => setTimeout(r, 5))
      return 'done'
    })
    expect(out).toBe('done')
    expect(sw.summarize().phases.ocr).toBeGreaterThanOrEqual(3)
  })

  it('同名阶段累加（N 条目装配多次记同一阶段）', () => {
    const sw = new Stopwatch()
    sw.record('build', 1.5)
    sw.record('build', 2.25)
    expect(sw.summarize().phases.build).toBe(3.8) // 四舍五入到 1 位小数
  })

  it('measureAsync 中抛错也会记时（观测失败步骤耗时），异常照常冒泡', async () => {
    const sw = new Stopwatch()
    await expect(
      sw.measureAsync('boom', async () => {
        throw new Error('x')
      }),
    ).rejects.toThrow('x')
    expect(typeof sw.summarize().phases.boom).toBe('number')
  })
})

describe('percentile（线性插值）', () => {
  it('空数组 → 0', () => {
    expect(percentile([], 50)).toBe(0)
    expect(percentile([], 95)).toBe(0)
  })

  it('单样本 → 该值', () => {
    expect(percentile([7], 50)).toBe(7)
    expect(percentile([7], 95)).toBe(7)
  })

  it('p50=中位数、p0=min、p100=max', () => {
    const s = [10, 20, 30, 40, 50]
    expect(percentile(s, 50)).toBe(30)
    expect(percentile(s, 0)).toBe(10)
    expect(percentile(s, 100)).toBe(50)
  })

  it('p95 线性插值（[10..50] rank=3.8 → 48）', () => {
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(48)
  })

  it('偶数个样本 p50 取中间两值均值', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5)
  })

  it('输入无需预排序（内部排序）', () => {
    expect(percentile([50, 10, 40, 20, 30], 50)).toBe(30)
  })
})

describe('aggregateTimings', () => {
  const samples: TimingSummary[] = [
    { totalMs: 100, phases: { detect: 30, ocr: 60, build: 10 } },
    { totalMs: 200, phases: { detect: 40, ocr: 140, build: 20 } },
    { totalMs: 300, phases: { detect: 50, ocr: 220, build: 30 } },
  ]

  it('统计 total 与各阶段 P50/P95 + count', () => {
    const agg = aggregateTimings(samples)
    expect(agg.count).toBe(3)
    expect(agg.total.p50).toBe(200)
    expect(agg.phases.ocr?.p50).toBe(140)
    expect(agg.phases.detect?.p50).toBe(40)
    // p95 插值：total rank=0.95*2=1.9 → 200+0.9*(300-200)=290
    expect(agg.total.p95).toBe(290)
  })

  it('某样本缺阶段 → 按 0 计入（不丢样本）', () => {
    const partial: TimingSummary[] = [
      { totalMs: 10, phases: { a: 10 } },
      { totalMs: 20, phases: { b: 20 } },
    ]
    const agg = aggregateTimings(partial)
    expect(agg.phases.a?.p50).toBe(5) // [10,0] 排序 [0,10] p50=5
    expect(agg.phases.b?.p50).toBe(10) // [0,20] p50=10
  })

  it('空样本 → count 0、total 0', () => {
    const agg = aggregateTimings([])
    expect(agg.count).toBe(0)
    expect(agg.total.p50).toBe(0)
  })
})
