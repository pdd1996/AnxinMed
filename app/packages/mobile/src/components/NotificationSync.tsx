import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { fetchDrugs, fetchPlans } from "@anxin/core";
import { isApiConfigured } from "@/lib/wiring";
import { syncRemindersFromServer } from "@/lib/reminder-sync";
import { useReminderSync } from "@/stores/reminderSync";

/**
 * 本地提醒的生命周期（M5-T8）：应用启动、回前台、计划数据变化时重排 expo-notifications。
 *
 * 放在根布局里（不依赖任何页面是否挂载）——今日页只在打开期间轮询，系统通知必须比页面活得久。
 * 提醒内容全部来自用户亲自确认的计划；没有计划时排定结果为空，不产生任何通知。
 */
export function NotificationSync() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const configured = isApiConfigured();
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);
  // 订阅与药箱页相同的查询键：计划/药品一变（新建、暂停、结束、删药）就重排。
  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: fetchPlans, enabled: configured });
  const drugsQuery = useQuery({ queryKey: ["drugs"], queryFn: fetchDrugs, enabled: configured });

  const sync = useCallback(
    async (force: boolean) => {
      if (!configured) return;
      useReminderSync.getState().markSyncing();
      try {
        await syncRemindersFromServer(queryClient, { force });
      } catch (error) {
        // 网络失败保留既有闹钟；错误在设置页可见，不静默吞掉。
        useReminderSync
          .getState()
          .applyError(error instanceof Error ? error.message : "提醒排定失败，请检查网络");
      }
    },
    [configured, queryClient],
  );

  useEffect(() => {
    if (!plansQuery.data) return;
    void sync(false);
  }, [plansQuery.data, drugsQuery.data, sync]);

  // 读不到计划时提醒排不了，但既有闹钟不动；把错误落到设置页可见的位置，禁静默吞掉。
  useEffect(() => {
    const error = plansQuery.error ?? drugsQuery.error;
    if (!error) return;
    useReminderSync
      .getState()
      .applyError(error instanceof Error ? error.message : "计划读取失败，提醒未更新");
  }, [plansQuery.error, drugsQuery.error]);

  // 回前台强制重排：用户可能刚从系统设置里开了通知/精确闹钟，旧闹钟需要按新权限重挂。
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync(true);
    });
    return () => subscription.remove();
  }, [sync]);

  // 点击通知（含冷启动）→ 回今日页处理。只认 1 分钟内的响应，避免冷启动翻出很久以前的旧响应。
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handledResponse.current = response.notification.request.identifier;
      router.push("/");
    });
    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    if (!lastResponse) return;
    const identifier = lastResponse.notification.request.identifier;
    if (handledResponse.current === identifier) return;
    if (Date.now() - lastResponse.notification.date > 60_000) return;
    handledResponse.current = identifier;
    router.push("/");
  }, [lastResponse, router]);

  return null;
}
