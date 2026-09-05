/**
 * lib.ts 纯函数单测（执行总纲 §3.3：纯函数单测是测试金字塔大头）。
 * 每个函数 ≥ 3 case；确定性、零 I/O。
 */
import { describe, it, expect } from 'vitest'
import {
  todayStr,
  addDaysStr,
  daysBetween,
  estimateStockDays,
  suggestTimes,
  isPlanActiveOn,
} from './lib.js'

describe('todayStr', () => {
  it('返回 YYYY-MM-DD 格式', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('与本地今日一致', () => {
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(todayStr()).toBe(expected)
  })
  it('长度恒为 10（月/日补零）', () => {
    expect(todayStr()).toHaveLength(10)
  })
})

describe('addDaysStr', () => {
  it('正数天（同月）', () => {
    expect(addDaysStr('2026-09-05', 7)).toBe('2026-09-12')
  })
  it('跨月进位', () => {
    expect(addDaysStr('2026-09-28', 5)).toBe('2026-10-03')
  })
  it('负数天（回溯）', () => {
    expect(addDaysStr('2026-09-05', -5)).toBe('2026-08-31')
  })
  it('非法输入返回空串', () => {
    expect(addDaysStr('not-a-date', 1)).toBe('')
  })
})

describe('daysBetween', () => {
  it('正向差', () => {
    expect(daysBetween('2026-09-01', '2026-09-08')).toBe(7)
  })
  it('负向差', () => {
    expect(daysBetween('2026-09-08', '2026-09-01')).toBe(-7)
  })
  it('同日为 0', () => {
    expect(daysBetween('2026-09-05', '2026-09-05')).toBe(0)
  })
  it('非法输入返回 0', () => {
    expect(daysBetween('bad', '2026-09-05')).toBe(0)
  })
})

describe('estimateStockDays', () => {
  it('海露：200 滴，1 滴 × 4 次/日 → 50 天', () => {
    expect(estimateStockDays(200, 1, 4)).toBe(50)
  })
  it('向下取整', () => {
    expect(estimateStockDays(10, 3, 1)).toBe(3) // 10 / 3 = 3.33 → 3
  })
  it('每日用量为 0 → 返回 0（不除零）', () => {
    expect(estimateStockDays(100, 0, 4)).toBe(0)
    expect(estimateStockDays(100, 1, 0)).toBe(0)
  })
})

describe('suggestTimes', () => {
  it('每日 1 次 → 08:00', () => {
    expect(suggestTimes(1)).toEqual(['08:00'])
  })
  it('每日 4 次 → 8/12/16/20（PRD §7.3.3）', () => {
    expect(suggestTimes(4)).toEqual(['08:00', '12:00', '16:00', '20:00'])
  })
  it('每日 2 次 → 8/20', () => {
    expect(suggestTimes(2)).toEqual(['08:00', '20:00'])
  })
  it('频次 clamp 到 1..8', () => {
    expect(suggestTimes(0)).toEqual(['08:00']) // <1 → 1
    expect(suggestTimes(20)).toHaveLength(8) // >8 → 8
  })
})

describe('isPlanActiveOn', () => {
  const base = { status: 'active', startDate: '2026-09-01', endDate: '2026-09-10' }
  it('窗口内生效', () => {
    expect(isPlanActiveOn(base, '2026-09-05')).toBe(true)
  })
  it('边界（起始日 / 结束日当日）生效', () => {
    expect(isPlanActiveOn(base, '2026-09-01')).toBe(true)
    expect(isPlanActiveOn(base, '2026-09-10')).toBe(true)
  })
  it('窗口外不生效', () => {
    expect(isPlanActiveOn(base, '2026-09-11')).toBe(false)
    expect(isPlanActiveOn(base, '2026-08-31')).toBe(false)
  })
  it('非 active（paused/ended）不生效', () => {
    expect(isPlanActiveOn({ ...base, status: 'paused' }, '2026-09-05')).toBe(false)
    expect(isPlanActiveOn({ ...base, status: 'ended' }, '2026-09-05')).toBe(false)
  })
  it('开放式（endDate 为 null）长期生效', () => {
    expect(isPlanActiveOn({ status: 'active', startDate: '2026-09-01', endDate: null }, '2027-01-01')).toBe(true)
  })
})
