import { describe, it, expect } from 'vitest'
import { groupTasksByPlan, duePendingSlots, type TodayTaskItem } from './tasks'

const base = {
  drugId: 'd1',
  drugName: '测试药',
  specification: '5mg',
  dose: { value: 1, unit: '片' },
  frequency: 2,
  route: null,
  cycleType: 'open',
  endDate: null,
}

function item(planId: string, time: string, status: TodayTaskItem['status']): TodayTaskItem {
  return { planId, ...base, time, status }
}

describe('groupTasksByPlan', () => {
  it('按 planId 分组并保持 slots 按时间排序', () => {
    const groups = groupTasksByPlan([
      item('p1', '19:00', 'pending'),
      item('p1', '08:00', 'taken'),
      item('p2', '08:00', 'pending'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].planId).toBe('p1')
    expect(groups[0].slots.map((s) => s.time)).toEqual(['08:00', '19:00'])
    expect(groups[0].slots[0].status).toBe('taken')
    expect(groups[1].planId).toBe('p2')
  })

  it('空输入返回空数组', () => {
    expect(groupTasksByPlan([])).toEqual([])
  })
})

describe('duePendingSlots', () => {
  it('只返回到点且仍 pending 的时间点', () => {
    const groups = groupTasksByPlan([
      item('p1', '08:00', 'taken'),
      item('p1', '09:00', 'pending'),
      item('p1', '23:00', 'pending'),
    ])
    const due = duePendingSlots(groups[0], '10:00')
    expect(due.map((s) => s.time)).toEqual(['09:00'])
  })
})
