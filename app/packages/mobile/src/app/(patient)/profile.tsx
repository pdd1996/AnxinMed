import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useUnstableNativeVariable } from "nativewind";
import {
  ChevronRight,
  ClipboardList,
  Settings as SettingsIcon,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { TAB_BAR_BOTTOM_PAD } from "@/lib/layout";

/**
 * 我的页（M5-T5e）：账号头部 + 列表式入口行（健康信息 / 记录 / 设置）。
 * 健康信息自 2026-11-18 起是独立一级页（与服药记录同级），不再在「我的」页内嵌表单卡。
 * 处方抄录·已确认那一入口在草稿确认页（M2 线）。
 */
export default function Profile() {
  const router = useRouter();
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");

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
