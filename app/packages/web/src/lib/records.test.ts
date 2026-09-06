/**
 * M3-T6 · records 纯函数单测：日/周/月区间换算 + CSV 生成（BOM/转义/状态中文化）。
 * 用固定本地日期断言（2026-09-07 为周一，避免依赖运行当天）。
 */
import { describe, it, expect } from 'vitest'
import { toISODate, computeRange, recordsToCsv, RECORD_STATUS_LABEL, type RecordCsvRow } from './records'

describe('toISODate', () => {
  it('本地年月日补零 → YYYY-MM-DD', () => {
    expect(toISODate(new Date(2026, 8, 7))).toBe('2026-09-07')
    expect(toISODate(new Date(2026, 0, 1))).toBe('2026-01-01') // 月/日补零
    expect(toISODate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('computeRange（按日/周/月）', () => {
  it('day → from=to=当天', () => {
    expect(computeRange('day', new Date(2026, 8, 9))).toEqual({ from: '2026-09-09', to: '2026-09-09' })
  })

  it('week → 本周一..今天（周一当天则 from=to）', () => {
    // 2026-09-07 是周一
    expect(computeRange('week', new Date(2026, 8, 7))).toEqual({ from: '2026-09-07', to: '2026-09-07' })
    // 2026-09-09 是周三 → 本周一 09-07
    expect(computeRange('week', new Date(2026, 8, 9))).toEqual({ from: '2026-09-07', to: '2026-09-09' })
    // 2026-09-13 是周日 → 本周一 09-07
    expect(computeRange('week', new Date(2026, 8, 13))).toEqual({ from: '2026-09-07', to: '2026-09-13' })
  })

  it('month → 本月 1 号..今天', () => {
    expect(computeRange('month', new Date(2026, 8, 15))).toEqual({ from: '2026-09-01', to: '2026-09-15' })
    expect(computeRange('month', new Date(2026, 8, 1))).toEqual({ from: '2026-09-01', to: '2026-09-01' })
  })
})

describe('recordsToCsv', () => {
  const rows: RecordCsvRow[] = [
    { scheduledDate: '2026-09-05', scheduledTime: '08:00', drugName: '玻璃酸钠滴眼液', status: 'taken', actedAt: '2026-09-05T00:01:00.000Z' },
    { scheduledDate: '2026-09-01', scheduledTime: '20:00', drugName: '二甲双胍', status: 'skipped', actedAt: '2026-09-01T12:05:00.000Z' },
  ]

  it('空数组 → 仅 BOM + 表头', () => {
    expect(recordsToCsv([])).toBe('\uFEFF日期,时间,药品,状态,操作时间')
  })

  it('带 UTF-8 BOM + 中文表头 + CRLF 分行 + 状态中文化', () => {
    const csv = recordsToCsv(rows)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.slice(1).split('\r\n') // 去 BOM 后按 CRLF 拆
    expect(lines[0]).toBe('日期,时间,药品,状态,操作时间')
    expect(lines[1]).toBe('2026-09-05,08:00,玻璃酸钠滴眼液,已服,2026-09-05T00:01:00.000Z')
    expect(lines[2]).toContain('已跳过')
  })

  it('含逗号/引号的药名 → RFC4180 转义（双引号包裹 + 引号翻倍）', () => {
    const csv = recordsToCsv([{ scheduledDate: '2026-09-05', scheduledTime: '08:00', drugName: '药,名"X"', status: 'taken', actedAt: 't' }])
    expect(csv).toContain('"药,名""X""')
  })

  it('未知状态 → 原样输出（不丢数据）', () => {
    const csv = recordsToCsv([{ scheduledDate: 'd', scheduledTime: 't', drugName: 'x', status: 'weird', actedAt: 'a' }])
    expect(csv).toContain('weird')
  })

  it('状态标签覆盖 taken/skipped/later', () => {
    expect(RECORD_STATUS_LABEL.taken).toBe('已服')
    expect(RECORD_STATUS_LABEL.skipped).toBe('已跳过')
    expect(RECORD_STATUS_LABEL.later).toBe('稍后提醒')
  })
})
