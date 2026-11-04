import { create } from "zustand";

/** 通知权限三态 + unknown（尚未查询/非安卓）。 */
export type ReminderPermission = "granted" | "denied" | "undetermined" | "unknown";

interface ReminderSyncState {
  permission: ReminderPermission;
  scheduledCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  syncing: boolean;
  markSyncing: () => void;
  setPermission: (permission: ReminderPermission) => void;
  applyResult: (input: {
    permission: ReminderPermission;
    scheduledCount: number;
    syncedAt?: number;
  }) => void;
  applyError: (message: string) => void;
}

/**
 * 本地提醒排定的可观察状态（M5-T8）：设置页/今日页读它显示「权限是否开启、排了几条、上次同步」。
 * 只存 UI 状态，不持久化——每次启动由 NotificationSync 重新排定并回填。
 */
export const useReminderSync = create<ReminderSyncState>()((set) => ({
  permission: "unknown",
  scheduledCount: 0,
  lastSyncedAt: null,
  lastError: null,
  syncing: false,
  markSyncing: () => set({ syncing: true }),
  setPermission: (permission) => set({ permission }),
  applyResult: ({ permission, scheduledCount, syncedAt = Date.now() }) =>
    set({
      permission,
      scheduledCount,
      lastSyncedAt: syncedAt,
      lastError: null,
      syncing: false,
    }),
  applyError: (message) =>
    set({
      lastError: message,
      syncing: false,
    }),
}));
