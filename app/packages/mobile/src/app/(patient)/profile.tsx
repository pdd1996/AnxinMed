import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useUnstableNativeVariable } from "nativewind";
import {
  ChevronRight,
  ClipboardList,
  LogOut,
  Settings as SettingsIcon,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { signOut, useAuthStore } from "@anxin/core";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { TAB_BAR_BOTTOM_PAD } from "@/lib/layout";

/**
 * 我的页（M5-T5e）：账号头部 + 列表式入口行（健康信息 / 记录 / 设置）+ 底部账号区（退出登录）。
 * 健康信息自 2026-11-18 起是独立一级页（与服药记录同级），不再在「我的」页内嵌表单卡。
 * 退出登录是账号级动作，按「设置」与「账号」的层级归位到本页底部（password 模式才显示）。
 * 处方抄录·已确认那一入口在草稿确认页（M2 线）。
 */
export default function Profile() {
  const router = useRouter();
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const riskL4 = useUnstableNativeVariable("--risk-l4");
  // 登录态（G7）：demo 模式免登录，账号区不出现。账号串是内部演示 ID，患者端不展示，只保留退出动作。
  const authMode = useAuthStore((s) => s.mode);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      // 退出后 AuthGate 自动切回登录页，本页随之卸载。
    } finally {
      setSigningOut(false);
    }
  }

  function confirmSignOut() {
    Alert.alert("退出登录", "退出后需要重新输入账号和密码。", [
      { text: "取消", style: "cancel" },
      { text: "退出", style: "destructive", onPress: () => void handleSignOut() },
    ]);
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingBottom: TAB_BAR_BOTTOM_PAD,
        paddingTop: 16,
      }}
    >
      <View className="flex-row items-center gap-3">
        <View className="size-16 shrink-0 items-center justify-center rounded-2xl bg-secondary">
          <Icon as={UserRound} size={30} color={mutedForeground} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-xl font-bold text-foreground">演示用户 · 张某某</Text>
        </View>
      </View>

      <Card className="mt-5 p-0">
        <CardContent className="p-0">
          <EntryRow
            icon={UserRound}
            label="健康信息"
            onPress={() => router.push("/health-info")}
          />
          <View className="border-b border-border" />
          <EntryRow
            icon={ClipboardList}
            label="服药记录"
            onPress={() => router.push("/records")}
          />
          <View className="border-b border-border" />
          <EntryRow
            icon={SettingsIcon}
            label="设置"
            onPress={() => router.push("/settings")}
          />
        </CardContent>
      </Card>

      {authMode === "demo" ? null : (
        <Card className="mt-5 p-0">
          <CardContent className="p-0">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: signingOut }}
              disabled={signingOut}
              onPress={confirmSignOut}
              className="min-h-[56px] flex-row items-center gap-3 px-4 active:opacity-80"
            >
              <Icon as={LogOut} size={20} color={riskL4} />
              <Text className="flex-1 text-base font-medium text-risk-l4">
                {signingOut ? "正在退出…" : "退出登录"}
              </Text>
            </Pressable>
          </CardContent>
        </Card>
      )}
    </ScrollView>
  );
}

/** 列表入口行（web 的 EntryLink）：图标 tile + 标签 + 右箭头，整行可点、触控 ≥44px。 */
function EntryRow({
  icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-[64px] flex-row items-center gap-3 px-4 py-2 active:opacity-80"
    >
      <View className="size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon as={icon} size={20} color={mutedForeground} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-base font-semibold text-card-foreground">{label}</Text>
      </View>
      <Icon as={ChevronRight} size={20} color={mutedForeground} />
    </Pressable>
  );
}
