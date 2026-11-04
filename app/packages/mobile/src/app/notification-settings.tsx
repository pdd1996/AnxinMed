import { useCallback, useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Device from "expo-device";
import * as IntentLauncher from "expo-intent-launcher";
import Constants from "expo-constants";
import { AlarmClock, BatteryCharging, Bell, Power, RefreshCw } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { Text } from "@/components/ui/text";
import { getReminderPermission, requestReminderPermission } from "@/lib/notifications";
import { syncRemindersFromServer } from "@/lib/reminder-sync";
import { isApiConfigured } from "@/lib/wiring";
import { useReminderSync, type ReminderPermission } from "@/stores/reminderSync";

const PACKAGE_NAME = Constants.expoConfig?.android?.package ?? "com.anxin.mobile";
const PACKAGE_URI = `package:${PACKAGE_NAME}`;

const PERMISSION_LABEL: Record<ReminderPermission, string> = {
  granted: "已允许",
  denied: "已拒绝（系统不再弹窗，需去设置打开）",
  undetermined: "还没询问",
  unknown: "查询中…",
};

const ROM_GUIDES = [
  {
    brand: "小米 / 红米 / POCO",
    keys: ["xiaomi", "redmi", "poco"],
    steps: [
      "设置 → 应用设置 → 应用管理 → 安心用药 → 省电策略 → 无限制",
      "设置 → 应用设置 → 授权管理 → 自启动 → 允许安心用药",
      "设置 → 应用设置 → 应用管理 → 安心用药 → 通知 → 允许通知",
    ],
  },
  {
    brand: "华为 / 荣耀",
    keys: ["huawei", "honor", "hihonor"],
    steps: [
      "设置 → 应用和服务 → 应用启动管理 → 安心用药 → 关闭「自动管理」，勾选允许自启动/关联启动/后台活动",
      "设置 → 电池 → 更多电池设置 → 休眠时始终保持网络连接",
    ],
  },
  {
    brand: "OPPO / 一加 / realme",
    keys: ["oppo", "oneplus", "realme", "oplus"],
    steps: [
      "设置 → 应用管理 → 安心用药 → 耗电管理 → 允许完全后台行为",
      "设置 → 应用管理 → 安心用药 → 自启动 → 允许",
    ],
  },
  {
    brand: "vivo / iQOO",
    keys: ["vivo", "iqoo"],
    steps: [
      "设置 → 应用与权限 → 权限管理 → 自启动 → 允许安心用药",
      "设置 → 电池 → 后台高耗电 → 允许安心用药",
    ],
  },
  {
    brand: "三星",
    keys: ["samsung"],
    steps: [
      "设置 → 电池和设备维护 → 电池 → 后台使用限制 → 从不休眠的应用 → 添加安心用药",
    ],
  },
] as const;

const AUTOSTART_TARGETS: Record<string, Array<{ packageName: string; className: string }>> = {
  xiaomi: [
    {
      packageName: "com.miui.securitycenter",
      className: "com.miui.permcenter.autostart.AutoStartManagementActivity",
    },
  ],
  huawei: [
    {
      packageName: "com.huawei.systemmanager",
      className: "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
    },
  ],
  honor: [
    {
      packageName: "com.hihonor.systemmanager",
      className: "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
    },
  ],
  oppo: [
    {
      packageName: "com.coloros.safecenter",
      className: "com.coloros.safecenter.permission.startup.StartupAppListActivity",
    },
    {
      packageName: "com.oplus.safecenter",
      className: "com.oplus.safecenter.permission.startup.StartupAppListActivity",
    },
  ],
  vivo: [
    {
      packageName: "com.vivo.permissionmanager",
      className: "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
    },
  ],
  iqoo: [
    {
      packageName: "com.iqoo.secure",
      className: "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
    },
  ],
};

function manufacturerKey(manufacturer: string | null): string {
  return (manufacturer ?? "").trim().toLowerCase();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatClock(timestamp: number | null): string {
  if (!timestamp) return "还没同步";
  const d = new Date(timestamp);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 通知与提醒设置引导页（M5-T8）。
 *
 * 白名单/自启动/精确闹钟是厂商与 Android 版本差异最大的一段：能直接打开的给按钮（intent），
 * 打不开的给本机品牌的逐步路径（不静默失败）；通知权限是本应用唯一能自动查询的状态。
 * 从任一系统页返回后都会重排一次提醒——精确闹钟权限开了之后，旧的一次性闹钟需要重挂。
 */
export default function NotificationSettings() {
  const queryClient = useQueryClient();
  const configured = isApiConfigured();
  const primary = useUnstableNativeVariable("--primary");
  const permission = useReminderSync((state) => state.permission);
  const scheduledCount = useReminderSync((state) => state.scheduledCount);
  const lastSyncedAt = useReminderSync((state) => state.lastSyncedAt);
  const lastError = useReminderSync((state) => state.lastError);
  const syncing = useReminderSync((state) => state.syncing);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const manufacturer = manufacturerKey(Device.manufacturer);
  const currentRom = ROM_GUIDES.find((rom) => rom.keys.some((key) => manufacturer.includes(key)));
  const androidVersion = Platform.OS === "android" ? Number(Platform.Version) : 0;
  const showExactAlarm = Platform.OS === "android" && androidVersion >= 31;

  const refreshPermission = useCallback(async () => {
    try {
      const next = await getReminderPermission();
      useReminderSync.getState().setPermission(next);
    } catch {
      // 查询失败不阻塞页面：状态保持上一次值，排定按钮仍可手动重试。
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshPermission();
    }, [refreshPermission]),
  );

  async function syncNow(force: boolean) {
    if (!configured) {
      setMessage({ tone: "error", text: "还没配置服务器地址，读不到计划，无法排定提醒" });
      return;
    }
    const outcome = await syncRemindersFromServer(queryClient, { force });
    const count = useReminderSync.getState().scheduledCount;
    if (outcome.status === "permission-denied") {
      setMessage({ tone: "error", text: "通知权限还没开启，提醒没有排定" });
    } else if (outcome.status === "unsupported") {
      setMessage({ tone: "error", text: "当前系统不支持本地通知" });
    } else {
      setMessage({ tone: "info", text: `已排定 ${count} 条到点提醒` });
    }
  }

  async function run(key: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "这一步没完成，请重试",
      });
    } finally {
      setBusy(null);
    }
  }

  /** 打开系统页；返回应用后刷新权限并强制重排（精确闹钟开关变化要重挂旧闹钟）。 */
  async function openSystemScreen(
    action: string,
    params?: IntentLauncher.IntentLauncherParams,
  ): Promise<boolean> {
    try {
      await IntentLauncher.startActivityAsync(action, params);
    } catch {
      try {
        await Linking.openSettings();
      } catch {
        return false;
      }
    }
    await refreshPermission();
    if (configured) {
      try {
        await syncRemindersFromServer(queryClient, { force: true });
      } catch {
        // 网络失败时保留既有闹钟；设置页的排定状态区会显示上次错误。
      }
    }
    return true;
  }

  function handleNotification() {
    void run("permission", async () => {
      const current = await getReminderPermission();
      useReminderSync.getState().setPermission(current);
      if (current === "undetermined") {
        const next = await requestReminderPermission();
        useReminderSync.getState().setPermission(next);
        if (next === "granted") {
          await syncNow(true);
          setMessage({ tone: "info", text: "通知已开启，已按当前计划重新排定提醒" });
        } else {
          setMessage({
            tone: "error",
            text: "系统没有允许通知。请到 系统设置 → 应用 → 安心用药 → 通知 里手动打开",
          });
        }
        return;
      }
      const opened = await openSystemScreen("android.settings.APP_NOTIFICATION_SETTINGS", {
        extra: { "android.provider.extra.APP_PACKAGE": PACKAGE_NAME },
      });
      setMessage(
        opened
          ? { tone: "info", text: "已从系统设置返回，通知权限状态已刷新" }
          : { tone: "error", text: "没打开通知设置，请手动到系统设置里找「安心用药 → 通知」" },
      );
    });
  }

  function handleExactAlarm() {
    void run("exact", async () => {
      const opened = await openSystemScreen("android.settings.REQUEST_SCHEDULE_EXACT_ALARM", {
        data: PACKAGE_URI,
      });
      setMessage(
        opened
          ? { tone: "info", text: "已返回应用；若「闹钟和提醒」已允许，提醒会按精确时间重排" }
          : {
              tone: "error",
              text: "没打开精确闹钟设置，请手动到 设置 → 应用 → 特殊权限 → 闹钟和提醒 里允许",
            },
      );
    });
  }

  function handleBattery() {
    void run("battery", async () => {
      const opened = await openSystemScreen("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
      setMessage(
        opened
          ? { tone: "info", text: "请确认列表里的「安心用药」是「不限制 / 允许后台运行」" }
          : {
              tone: "error",
              text: "没打开电池优化设置，请手动到 设置 → 电池 → 电池优化 里把安心用药设为不限制",
            },
      );
    });
  }

  function handleAutostart() {
    void run("autostart", async () => {
      const keys = Object.keys(AUTOSTART_TARGETS).filter((key) => manufacturer.includes(key));
      let opened = false;
      for (const key of keys) {
        for (const target of AUTOSTART_TARGETS[key]) {
          try {
            await IntentLauncher.startActivityAsync("android.intent.action.MAIN", {
              packageName: target.packageName,
              className: target.className,
              flags: 0x10000000,
            });
            opened = true;
            break;
          } catch {
            // 不同 ROM 版本类名会变，继续试下一个入口。
          }
        }
        if (opened) break;
      }
      if (opened) {
        setMessage({ tone: "info", text: "已打开自启动设置；允许「安心用药」自启动后返回" });
        return;
      }
      try {
        await Linking.openSettings();
      } catch {
        // 连应用详情都打不开时，下面的 ROM 路径仍可手找。
      }
      setMessage({
        tone: "error",
        text: "这台机型没有可直接打开的自启动页，请按下面「本机品牌」的路径手动找",
      });
    });
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: 16 }}
    >
      <Text className="text-2xl font-bold text-foreground">到点提醒</Text>
      <Text className="mt-1 text-base leading-6 text-muted-foreground">
        提醒来自你亲自确认的用药计划。退到后台或关闭应用后由系统通知；应用打开时用页内提醒弹窗，避免两条同时响。
      </Text>

      <View className="mt-5 rounded-2xl border border-border bg-card p-4">
        <Text className="text-sm text-muted-foreground">当前状态</Text>
        <View className="mt-2 flex-row items-baseline justify-between gap-3">
          <Text className="text-base text-card-foreground">通知权限</Text>
          <Text
            className={`text-base font-semibold ${
              permission === "granted" ? "text-risk-l1" : "text-risk-l3"
            }`}
          >
            {PERMISSION_LABEL[permission]}
          </Text>
        </View>
        <View className="mt-1 flex-row items-baseline justify-between gap-3">
          <Text className="text-base text-card-foreground">已排定提醒</Text>
          <Text className="text-base font-semibold text-card-foreground">{scheduledCount} 条</Text>
        </View>
        <View className="mt-1 flex-row items-baseline justify-between gap-3">
          <Text className="text-base text-card-foreground">上次同步</Text>
          <Text className="text-base text-muted-foreground">{formatClock(lastSyncedAt)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy !== null || syncing}
          onPress={() => void run("sync", () => syncNow(true))}
          className="mt-3 min-h-[48px] flex-row items-center justify-center gap-2 rounded-xl border border-border bg-card active:opacity-80"
        >
          <RefreshCw size={18} color={primary} importantForAccessibility="no" />
          <Text className="text-base font-medium text-card-foreground">
            {syncing ? "正在重新排定…" : "立即重新排定提醒"}
          </Text>
        </Pressable>
        {lastError ? (
          <View className="mt-3 rounded-xl border border-risk-l4 bg-risk-l4-tint p-3">
            <Text className="text-sm leading-5 text-risk-l4">{lastError}</Text>
          </View>
        ) : null}
        {message ? (
          <View
            className={`mt-3 rounded-xl border p-3 ${
              message.tone === "error"
                ? "border-risk-l4 bg-risk-l4-tint"
                : "border-risk-l1 bg-risk-l1-tint"
            }`}
          >
            <Text
              className={`text-sm leading-5 ${
                message.tone === "error" ? "text-risk-l4" : "text-risk-l1"
              }`}
            >
              {message.text}
            </Text>
          </View>
        ) : null}
      </View>

      <Section
        icon={<Bell size={20} color={primary} importantForAccessibility="no" />}
        title="1. 允许通知"
        body="Android 13 起，通知是运行时权限。被拒绝后系统不再自动弹窗，只能到系统设置里打开。"
        action={
          <GuideButton
            label={permission === "granted" ? "管理通知权限" : "开启通知"}
            busy={busy === "permission"}
            onPress={handleNotification}
          />
        }
      />

      {showExactAlarm ? (
        <Section
          icon={<AlarmClock size={20} color={primary} importantForAccessibility="no" />}
          title="2. 允许「闹钟和提醒」（精确闹钟）"
          body="Android 12 起这是单独的特殊权限，Android 13+ 新安装应用默认关闭。没开时系统可能为省电把提醒推迟几分钟到几十分钟。"
          action={
            <GuideButton
              label="去开启精确闹钟"
              busy={busy === "exact"}
              onPress={handleExactAlarm}
            />
          }
        />
      ) : null}

      <Section
        icon={<BatteryCharging size={20} color={primary} importantForAccessibility="no" />}
        title={`${showExactAlarm ? "3" : "2"}. 电池优化白名单`}
        body="系统省电会冻结后台应用，闹钟随之被杀。把「安心用药」设为不受限制，才能稳定收到到点提醒。"
        action={
          <GuideButton
            label="去设置电池优化"
            busy={busy === "battery"}
            onPress={handleBattery}
          />
        }
      />

      <Section
        icon={<Power size={20} color={primary} importantForAccessibility="no" />}
        title={`${showExactAlarm ? "4" : "3"}. 允许自启动`}
        body="国产 ROM 会限制后台自启动；关闭后重启手机可能收不到提醒。下面按本机品牌给了路径。"
        action={
          <GuideButton label="去设置自启动" busy={busy === "autostart"} onPress={handleAutostart} />
        }
      />

      <View className="mt-8">
        <Text className="text-lg font-semibold text-foreground">本机品牌设置路径</Text>
        <Text className="mt-1 text-sm leading-6 text-muted-foreground">
          当前设备：{Device.manufacturer ?? "未知厂商"} {Device.modelName ?? ""} · Android{" "}
          {Platform.OS === "android" ? Platform.Version : "—"}
        </Text>
        <View className="mt-3 gap-3">
          {ROM_GUIDES.map((rom) => {
            const isCurrent = currentRom?.brand === rom.brand;
            return (
              <View
                key={rom.brand}
                className={`rounded-2xl border bg-card p-4 ${
                  isCurrent ? "border-2 border-primary" : "border-border"
                }`}
              >
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="text-base font-bold text-card-foreground">{rom.brand}</Text>
                  {isCurrent ? (
                    <Text className="text-xs font-semibold text-primary">本机</Text>
                  ) : null}
                </View>
                <View className="mt-2 gap-1">
                  {rom.steps.map((step) => (
                    <Text key={step} className="text-sm leading-6 text-muted-foreground">
                      · {step}
                    </Text>
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <View className="mt-8 rounded-xl border border-border bg-card p-4">
        <Text className="text-sm leading-6 text-muted-foreground">
          两种「关掉应用」不一样：从最近任务划掉不影响闹钟；在系统设置里点「强行停止」会清空闹钟（Android
          的设计），需要重新打开一次应用。换了手机或在系统里改了时间/时区，也建议回本页点一次「立即重新排定提醒」。
        </Text>
      </View>
    </ScrollView>
  );
}

function Section({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <View className="mt-8 gap-2">
      <View className="flex-row items-center gap-2">
        {icon}
        <Text className="flex-1 text-base font-bold text-foreground">{title}</Text>
      </View>
      <Text className="text-sm leading-6 text-muted-foreground">{body}</Text>
      {action}
    </View>
  );
}

function GuideButton({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      className="mt-1 min-h-[52px] items-center justify-center rounded-xl bg-primary px-4 active:opacity-80"
    >
      <Text className="text-base font-semibold text-primary-foreground">
        {busy ? "正在打开…" : label}
      </Text>
    </Pressable>
  );
}
