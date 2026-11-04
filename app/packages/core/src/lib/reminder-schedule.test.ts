import { describe, expect, it } from 'vitest'
import {
  planReminderNotifications,
  REMINDER_ID_PREFIX,
  type ReminderPlanInput,
} from './reminder-schedule'

const NOW = new Date(2026, 9, 29, 9, 0) // 2026-10-29 09:00 本地

function plan(overrides: Partial<ReminderPlanInput> = {}): ReminderPlanInput {
  return {
    planId: 'plan-1',
    drugName: '苯磺酸氨氯地平片',
    dose: { value: 1, unit: '片' },
    times: ['08:00', '20:00'],
    status: 'active',
    startDate: '2026-10-01',
    endDate: null,
    ...overrides,
  }
}

describe('planReminderNotifications', () => {
  it('长期计划：每个时点一条 daily，触发时间正确、标识稳定', () => {
    const result = planReminderNotifications([plan()], { now: NOW })

    expect(result).toHaveLength(2)
    // 09:00 排定：今天的 08:00 已过，daily 的下一次落在明天 → 今天的 20:00 排在前面
    expect(result.map((item) => item.identifier)).toEqual([
      `${REMINDER_ID_PREFIX}plan-1:20:00`,
      `${REMINDER_ID_PREFIX}plan-1:08:00`,
    ])
    expect(result.map((item) => item.trigger)).toEqual([
      { kind: 'daily', hour: 20, minute: 0 },
      { kind: 'daily', hour: 8, minute: 0 },
    ])
    expect(result[0]).toMatchObject({
      title: '该服药了',
      body: '苯磺酸氨氯地平片 · 每次1片 · 20:00',
      data: { planId: 'plan-1', time: '20:00', url: '/' },
    })
    expect(result[1].body).toBe('苯磺酸氨氯地平片 · 每次1片 · 08:00')
  })

  it('暂停与已结束的计划不排', () => {
    expect(
      planReminderNotifications(
        [plan({ status: 'paused' }), plan({ planId: 'plan-2', status: 'ended' })],
        { now: NOW },
      ),
    ).toEqual([])
  })

  it('有结束日期的计划：逐日一次性，跳过今天已过的时点，止于结束日', () => {
    const result = planReminderNotifications(
      [plan({ times: ['08:00', '20:00'], endDate: '2026-10-31' })],
      { now: NOW },
    )

    // 今天 08:00 已过 → 只剩今天 20:00 + 10-30、10-31 各两个
    expect(result).toHaveLength(5)
    expect(result.map((item) => item.identifier)).toEqual([
      `${REMINDER_ID_PREFIX}plan-1:2026-10-29:20:00`,
      `${REMINDER_ID_PREFIX}plan-1:2026-10-30:08:00`,
      `${REMINDER_ID_PREFIX}plan-1:2026-10-30:20:00`,
      `${REMINDER_ID_PREFIX}plan-1:2026-10-31:08:00`,
      `${REMINDER_ID_PREFIX}plan-1:2026-10-31:20:00`,
    ])
    expect(result[0].trigger).toEqual({ kind: 'date', date: '2026-10-29', hour: 20, minute: 0 })
  })

  it('结束日期早于今天不排', () => {
    expect(planReminderNotifications([plan({ endDate: '2026-10-28' })], { now: NOW })).toEqual([])
  })

  it('尚未开始的长期计划：先从开始日逐日排，不进 daily 重复', () => {
    const result = planReminderNotifications(
      [plan({ startDate: '2026-11-02', times: ['08:00'] })],
      { now: NOW, horizonDays: 10 }, // 窗口 10-29 ~ 11-07
    )

    expect(result.map((item) => item.identifier)).toEqual([
      `${REMINDER_ID_PREFIX}plan-1:2026-11-02:08:00`,
      `${REMINDER_ID_PREFIX}plan-1:2026-11-03:08:00`,
      `${REMINDER_ID_PREFIX}plan-1:2026-11-04:08:00`,
      `${REMINDER_ID_PREFIX}plan-1:2026-11-05:08:00`,
      `${REMINDER_ID_PREFIX}plan-1:2026-11-06:08:00`,
      `${REMINDER_ID_PREFIX}plan-1:2026-11-07:08:00`,
    ])
    expect(result.every((item) => item.trigger.kind === 'date')).toBe(true)
  })

  it('窗口滚动：结束日期超出 horizon 时只排到窗口末', () => {
    const result = planReminderNotifications(
      [plan({ startDate: '2026-10-01', endDate: '2026-12-31', times: ['08:00'] })],
      { now: NOW, horizonDays: 3 }, // 10-29 ~ 10-31
    )

    expect(result.map((item) => item.identifier)).toEqual([
      `${REMINDER_ID_PREFIX}plan-1:2026-10-30:08:00`,
      `${REMINDER_ID_PREFIX}plan-1:2026-10-31:08:00`,
    ])
  })

  it('非法时点丢弃、重复时点去重', () => {
    const result = planReminderNotifications(
      [plan({ times: ['8:00', '25:00', '08:00', '08:00', '09:70', '12:30'] })],
      { now: NOW },
    )

    expect(result).toHaveLength(2)
    // 合法值只剩 08:00 与 12:30；09:00 排定时 12:30 在今天就到，08:00 的下一次是明天
    expect(result.map((item) => item.trigger)).toEqual([
      { kind: 'daily', hour: 12, minute: 30 },
      { kind: 'daily', hour: 8, minute: 0 },
    ])
  })

  it('上限按最近触发时间保留', () => {
    const result = planReminderNotifications(
      [plan(), plan({ planId: 'plan-2', endDate: '2026-10-31', times: ['08:00'] })],
      { now: NOW, maxNotifications: 1 },
    )

    // 今天的 20:00（daily）是最近的一次；cap=1 时它保留、其余全部截断
    expect(result.map((item) => item.identifier)).toEqual([`${REMINDER_ID_PREFIX}plan-1:20:00`])
  })

  it('空时点或非法 spec 不产生通知', () => {
    expect(planReminderNotifications([plan({ times: [] })], { now: NOW })).toEqual([])
    expect(planReminderNotifications([], { now: NOW })).toEqual([])
  })
})
