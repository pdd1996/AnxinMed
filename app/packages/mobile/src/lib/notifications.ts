import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  REMINDER_ID_PREFIX,
  type ReminderNotificationSpec,
} from "@anxin/core";
import { useReminderSync, type ReminderPermission } from "@/stores/reminderSync";

/** 通知渠道 id：Android 8+ 必须挂渠道，重要性 HIGH 才有横幅与声音。 */
export const REMINDER_CHANNEL_ID = "medication-reminders";

/** 提醒只在安卓端存在（本产品移动端仅 Android）。 */
export function remindersSupported(): boolean {
  return Platform.OS === "android";
}

/**
 * 前台不展示系统通知：今日页打开时由页内 ReminderModal 负责提醒（含播报与三出口），
 * 两条路同时弹会重复打断。退到后台/关闭应用后 handler 不参与，通知照常出。
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensureReminderChannel(): Promise<void> {
  if (!remindersSupported()) return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: "服药提醒",
    description: "按你确认的用药计划，在设定时间提醒服药",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    enableVibrate: true,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: false,
    bypassDnd: false,
  });
}

export async function getReminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported()) return "unknown";
  const status = await Notifications.getPermissionsAsync();
  if (status.granted) return "granted";
  return status.status === "denied" ? "denied" : "undetermined";
}

/** 请求通知权限（Android 13+ 弹系统对话框）。已被拒绝时系统不再允许弹，调用方应引导去系统设置。 */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported()) return "unknown";
  const status = await Notifications.requestPermissionsAsync();
  if (status.granted) {
    await ensureReminderChannel();
    return "granted";
  }
  return status.status === "denied" ? "denied" : "undetermined";
}

/** 已排定的本应用提醒条数（只数本模块命名空间，避免把别家通知算进来）。 */
export async function countScheduledReminders(): Promise<number> {
  if (!remindersSupported()) return 0;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled.filter((item) => item.identifier.startsWith(REMINDER_ID_PREFIX)).length;
}

function toExpoTrigger(spec: ReminderNotificationSpec): Notifications.NotificationTriggerInput {
  if (spec.trigger.kind === "daily") {
    return {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: spec.trigger.hour,
      minute: spec.trigger.minute,
      channelId: REMINDER_CHANNEL_ID,
    };
  }
  const [year, month, day] = spec.trigger.date.split("-").map(Number);
  return {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: new Date(year, month - 1, day, spec.trigger.hour, spec.trigger.minute),
    channelId: REMINDER_CHANNEL_ID,
  };
}

export type ReminderSyncStatus = "ok" | "unchanged" | "permission-denied" | "unsupported";

export interface ReminderSyncOutcome {
  status: ReminderSyncStatus;
  scheduled: number;
  canceled: number;
  failures: number;
}

/**
 * 把平台无关的排定项落到 expo-notifications（M5-T8）。
 *
 * - 权限未授予：撤掉本应用已排的提醒（避免「权限开了很久以前的通知才冒出来」），返回 permission-denied；
 * - 集合未变且非 force：不重复写系统（每次启动/回调都重排会无谓抖动）；
 * - force=true：全撤全排——用户从「精确闹钟」或通知设置返回后，旧闹钟可能是不精确的，需要重挂。
 */
export async function syncReminderNotifications(
  specs: ReminderNotificationSpec[],
  options: { force?: boolean } = {},
): Promise<ReminderSyncOutcome> {
  if (!remindersSupported()) {
    useReminderSync.getState().applyResult({ permission: "unknown", scheduledCount: 0 });
    return { status: "unsupported", scheduled: 0, canceled: 0, failures: 0 };
  }

  await ensureReminderChannel();
  const permission = await getReminderPermission();
  const existing = (await Notifications.getAllScheduledNotificationsAsync()).filter((item) =>
    item.identifier.startsWith(REMINDER_ID_PREFIX),
  );

  if (permission !== "granted") {
    let canceled = 0;
    for (const item of existing) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
      canceled += 1;
    }
    useReminderSync.getState().applyResult({ permission, scheduledCount: 0 });
    return { status: "permission-denied", scheduled: 0, canceled, failures: 0 };
  }

  const desiredById = new Map(specs.map((spec) => [spec.identifier, spec]));
  const existingById = new Map(existing.map((item) => [item.identifier, item]));
  const sameSet =
    desiredById.size === existingById.size &&
    [...desiredById].every(([identifier, spec]) => {
      const current = existingById.get(identifier);
      // 标识相同但文案变了（剂量/药名随计划修改）也要重排，不能只看 id 集合。
      return (
        current !== undefined &&
        current.content.title === spec.title &&
        current.content.body === spec.body
      );
    });

  if (sameSet && !options.force) {
    useReminderSync.getState().applyResult({ permission, scheduledCount: existing.length });
    return { status: "unchanged", scheduled: existing.length, canceled: 0, failures: 0 };
  }

  let canceled = 0;
  for (const item of existing) {
    const spec = desiredById.get(item.identifier);
    const contentChanged =
      spec !== undefined &&
      (item.content.title !== spec.title || item.content.body !== spec.body);
    if (options.force || spec === undefined || contentChanged) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
      canceled += 1;
    }
  }

  const remainingIds = options.force
    ? new Set<string>()
    : new Set(
        existing
          .filter((item) => {
            const spec = desiredById.get(item.identifier);
            return (
              spec !== undefined &&
              item.content.title === spec.title &&
              item.content.body === spec.body
            );
          })
          .map((item) => item.identifier),
      );
  let scheduled = 0;
  let failures = 0;
  const failureMessages: string[] = [];
  for (const spec of specs) {
    if (remainingIds.has(spec.identifier)) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: spec.identifier,
        content: {
          title: spec.title,
          body: spec.body,
          data: spec.data,
          sound: "default",
          priority: Notifications.AndroidNotificationPriority.HIGH,
        },
        trigger: toExpoTrigger(spec),
      });
      scheduled += 1;
    } catch (error) {
      failures += 1;
      failureMessages.push(`${spec.identifier}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const scheduledCount = await countScheduledReminders();
  useReminderSync.getState().applyResult({ permission, scheduledCount });
  if (failures > 0) {
    useReminderSync.getState().applyError(
      `${failures} 条提醒没能排定：${failureMessages.slice(0, 3).join("；")}`,
    );
  }

  return { status: "ok", scheduled, canceled, failures };
}

/** 清空本模块排定的全部提醒（排定策略整体失效时用，例如计划全部结束）。 */
export async function cancelAllReminderNotifications(): Promise<number> {
  if (!remindersSupported()) return 0;
  const existing = (await Notifications.getAllScheduledNotificationsAsync()).filter((item) =>
    item.identifier.startsWith(REMINDER_ID_PREFIX),
  );
  for (const item of existing) {
    await Notifications.cancelScheduledNotificationAsync(item.identifier);
  }
  return existing.length;
}
