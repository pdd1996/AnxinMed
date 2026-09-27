import { create } from 'zustand'

/** 提醒项：某计划在某时间点待提醒。 */
export interface ReminderItem {
  planId: string
  time: string
}

interface ReminderQueueState {
  queue: ReminderItem[]
  enqueue: (item: ReminderItem) => void
  dequeue: () => void
  clear: () => void
}

/**
 * 提醒队列骨架（M1-T8 建立，M2/T9 使用）。
 * 今日任务页在打开期间轮询比对当日任务，把到点未完成项入队，由提醒弹窗消费。
 * 本期仅建 state 与增删接口，不接轮询逻辑。
 */
export const useReminderQueue = create<ReminderQueueState>()((set) => ({
  queue: [],
  enqueue: (item) => set((s) => ({ queue: [...s.queue, item] })),
  dequeue: () => set((s) => ({ queue: s.queue.slice(1) })),
  clear: () => set({ queue: [] }),
}))
