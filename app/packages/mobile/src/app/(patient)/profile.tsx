import { useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useUnstableNativeVariable } from "nativewind";
import {
  ChevronRight,
  ClipboardList,
  IdCard,
  KeyRound,
  Settings as SettingsIcon,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { signOut, useAuthStore } from "@anxin/core";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { TAB_BAR_BOTTOM_PAD } from "@/lib/layout";

/**
 * 我的页（M5-T5e）：账号头部 + 分组的列表式入口行 + 底部账号区（退出登录）。
 * 健康信息自 2026-11-18 起是独立一级页（与服药记录同级），不再在「我的」页内嵌表单卡。
 * 退出登录是账号级动作，按「设置」与「账号」的层级归位到本页底部（password 模式才显示）。
 * 入口与 web 同步按用途分组（2026-11-19 晚：单卡多行视觉不舒服）：账号（个人资料 / 登录密码）、
 * 健康（健康信息 / 服药记录）；设置自成一组的「其他」；退出登录不进「其他」组。
 * 「登录密码」自 2026-11-19 起与 web 同步从设置页的「账号与安全」区块上移到这里（password 模式）：
 * 老人要先想到进设置、再滑到页底才可能发现，入口太深；设置页只留字号这类真正的设置项。
 * 处方抄录·已确认那一入口在草稿确认页（M2 线）。
 */
export default function Profile() {
  const router = useRouter();
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  // 登录态（G7）：demo 模式免登录，账号区不出现。账号串是内部演示 ID，患者端不展示，只保留退出动作。
  const authMode = useAuthStore((s) => s.mode);
  // 头部姓名读登录态（G8 增补）：不再是写死的「演示用户 · 张某某」，改完返回本页即见新名。
  // demo 模式保留「演示用户 · 」作模式标记；password 模式只显示姓名（真实账号不该标成演示用户）。
  const user = useAuthStore((s) => s.user);
  const [signingOut, setSigningOut] = useState(false);

  const displayName = user?.name?.trim() || "未设置姓名";
  const title = authMode === "demo" ? `演示用户 · ${displayName}` : displayName;

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
          <Text className="text-xl font-bold text-foreground" numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>

      <EntryGroup title="账号">
        <EntryRow icon={IdCard} label="个人资料" onPress={() => router.push("/account")} />
        {authMode === "password" ? (
          <>
            <View className="border-b border-border" />
            <EntryRow
              icon={KeyRound}
              label="登录密码"
              onPress={() => router.push("/password")}
            />
          </>
        ) : null}
      </EntryGroup>

      <EntryGroup title="健康">
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
      </EntryGroup>

      <EntryGroup title="其他">
        <EntryRow icon={SettingsIcon} label="设置" onPress={() => router.push("/settings")} />
      </EntryGroup>

      {authMode === "demo" ? null : (
        <Card className="mt-5 p-0">
          <CardContent className="p-0">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: signingOut }}
              disabled={signingOut}
              onPress={confirmSignOut}
              className="min-h-[56px] items-center justify-center px-4 active:opacity-80"
            >
              <Text className="text-base font-medium text-muted-foreground">
                {signingOut ? "正在退出…" : "退出登录"}
              </Text>
            </Pressable>
          </CardContent>
        </Card>
      )}
    </ScrollView>
  );
}

/** 入口分组：小标签 + 一张入口卡（组标签缩进到图标列；组内分隔线由调用方插入）。 */
function EntryGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-5 gap-2">
      <Text className="px-4 text-xs font-bold uppercase tracking-[2px] text-muted-foreground">
        {title}
      </Text>
      <Card className="p-0">
        <CardContent className="p-0">{children}</CardContent>
      </Card>
    </View>
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
