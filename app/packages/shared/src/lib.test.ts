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
  isIsoDate,
  daysUntilExpiry,
  expiryState,
  ageFromBirthMonth,
  EXPIRY_WARNING_DAYS,
  gradeAdherence,
  ADHERENCE_GRADE_THRESHOLDS,
  ADHERENCE_GRADE_LABEL,
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

describe('gradeAdherence（T7 · ADR #17 分档阈值边界）', () => {
  it('边界值：优 ≥95 / 中 80–94 / 差 <80', () => {
    expect(gradeAdherence(95)).toBe('good')
    expect(gradeAdherence(100)).toBe('good')
    expect(gradeAdherence(94)).toBe('fair')
    expect(gradeAdherence(80)).toBe('fair')
    expect(gradeAdherence(79)).toBe('poor')
    expect(gradeAdherence(0)).toBe('poor')
  })
  it('缺失/非法执行率返回 null（未分档，绝不臆测为差）', () => {
    expect(gradeAdherence(null)).toBeNull()
    expect(gradeAdherence(undefined)).toBeNull()
    expect(gradeAdherence(Number.NaN)).toBeNull()
  })
  it('阈值常量与判定函数一致（防止两处漂移）', () => {
    expect(ADHERENCE_GRADE_THRESHOLDS.good).toBe(95)
    expect(ADHERENCE_GRADE_THRESHOLDS.fair).toBe(80)
  })
  it('分档标签为医生可读中文（前后端同源）', () => {
    expect(ADHERENCE_GRADE_LABEL.good).toBe('优')
    expect(ADHERENCE_GRADE_LABEL.fair).toBe('中')
    expect(ADHERENCE_GRADE_LABEL.poor).toBe('差')
  })
})

describe('isIsoDate（有效期/开封日期入参）', () => {
  it('合法日期（含闰年 2 月 29）', () => {
    expect(isIsoDate('2027-03-01')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2026-12-31')).toBe(true)
  })
  it('格式不符（斜杠/无补零/带时间/空串）一律拒绝', () => {
    expect(isIsoDate('2027/03/01')).toBe(false)
    expect(isIsoDate('2027-3-1')).toBe(false)
    expect(isIsoDate('2027-03-01T00:00:00Z')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })
  it('日历上不存在的日期拒绝（new Date 会静默进位，不能只靠正则）', () => {
    expect(isIsoDate('2026-02-31')).toBe(false)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('2025-02-29')).toBe(false)
    expect(isIsoDate('2026-04-31')).toBe(false)
  })
  it('过去日期合法（已过期药也要能录）', () => {
    expect(isIsoDate('2020-01-01')).toBe(true)
  })
})

describe('效期状态 · 30 天临期口径（患者端提醒 / 咨询 S2 / 医生端一份真相）', () => {
  const TODAY = '2026-11-19'

  it('阈值常量为 30 天（用户 2026-11-19 拍板；promo 的 90 天口径不再采用）', () => {
    expect(EXPIRY_WARNING_DAYS).toBe(30)
  })

  it('已过期：昨天起任何过去日期 → expired，剩余天数为负', () => {
    expect(expiryState('2026-11-18', TODAY)).toBe('expired')
    expect(daysUntilExpiry('2026-11-18', TODAY)).toBe(-1)
    expect(expiryState('2020-01-01', TODAY)).toBe('expired')
  })

  it('临期边界：当天 / 第 30 天 → expiring；第 31 天 → ok（阈值含边界）', () => {
    expect(expiryState(TODAY, TODAY)).toBe('expiring')
    expect(expiryState('2026-12-19', TODAY)).toBe('expiring')
    expect(daysUntilExpiry('2026-12-19', TODAY)).toBe(30)
    expect(expiryState('2026-12-20', TODAY)).toBe('ok')
    expect(daysUntilExpiry('2026-12-20', TODAY)).toBe(31)
  })

  it('未录入 / 非法日期 → null（必须明说「未知」，不得当成「没有过期」）', () => {
    expect(expiryState(null, TODAY)).toBeNull()
    expect(expiryState(undefined, TODAY)).toBeNull()
    expect(expiryState('', TODAY)).toBeNull()
    expect(expiryState('2026-02-31', TODAY)).toBeNull()
    expect(daysUntilExpiry(null, TODAY)).toBeNull()
  })

  it('today 可注入（测试确定性），缺省取本地今日', () => {
    const today = todayStr()
    expect(expiryState(today)).toBe('expiring')
    expect(expiryState(addDaysStr(today, -1))).toBe('expired')
    expect(expiryState(addDaysStr(today, 31))).toBe('ok')
  })
})

describe('ageFromBirthMonth · 出生年月 → 周岁（年龄联动）', () => {
  /** 固定「今天」= 2026-11-19，跨年/跨月边界可复现。 */
  const today = new Date(2026, 10, 19)

  it('出生月份已过 / 就是本月 → 年龄 = 年差（1958-06 → 68，同月 1958-11 → 68）', () => {
    expect(ageFromBirthMonth('1958-06', today)).toBe(68)
    expect(ageFromBirthMonth('1958-11', today)).toBe(68)
  })

  it('出生月份还没到 → 今年生日未到，年龄 = 年差 − 1（1958-12 → 67）', () => {
    expect(ageFromBirthMonth('1958-12', today)).toBe(67)
    expect(ageFromBirthMonth('1958-01', today)).toBe(68)
  })

  it('跨年边界：1 月看去年 12 月出生 = 0 岁；去年 1 月出生 = 1 岁', () => {
    const janFirst = new Date(2027, 0, 1)
    expect(ageFromBirthMonth('2026-12', janFirst)).toBe(0)
    expect(ageFromBirthMonth('2026-01', janFirst)).toBe(1)
  })

  it('未来年月 / 非法形态 → null（调用方不得当作 0 岁或任何默认值）', () => {
    expect(ageFromBirthMonth('2026-12', today)).toBeNull() // 今年 12 月：尚未发生
    expect(ageFromBirthMonth('2999-01', today)).toBeNull()
    expect(ageFromBirthMonth('1958-13', today)).toBeNull()
    expect(ageFromBirthMonth('1958', today)).toBeNull()
    expect(ageFromBirthMonth('1958-6-1', today)).toBeNull()
    expect(ageFromBirthMonth('', today)).toBeNull()
  })

  it('月份不补零也接受（老数据可能存 1958-6）；超高龄（>150）拒绝', () => {
    expect(ageFromBirthMonth('1958-6', today)).toBe(68)
    expect(ageFromBirthMonth('1900-01', today)).toBe(126)
    expect(ageFromBirthMonth('1800-01', today)).toBeNull()
  })
})
