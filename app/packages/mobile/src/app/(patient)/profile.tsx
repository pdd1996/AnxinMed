import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useUnstableNativeVariable } from "nativewind";
import {
  AlertTriangle,
  ChevronRight,
  ClipboardList,
  Settings as SettingsIcon,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { HealthInfoCard } from "@/components/domain/profile/HealthInfoCard";
import { TAB_BAR_BOTTOM_PAD } from "@/lib/layout";

/**
 * 我的页（M5-T5e，照 web `routes/patient/Profile.tsx`）：账号头部 + 健康信息七字段卡 +
 * 列表式入口行（记录 / 设置）+ 测试数据免责条。处方抄录·已确认那一入口在草稿确认页（M2 线）。
 */
export default function Profile() {
  const router = useRouter();
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const riskL3 = useUnstableNativeVariable("--risk-l3");

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
          <Text className="mt-0.5 text-sm text-muted-foreground">
            本地演示账号 · 数据仅保存在演示库
          </Text>
        </View>
      </View>

      <View className="mt-5">
        <HealthInfoCard />
      </View>

      <Card className="mt-5 p-0">
        <CardContent className="p-0">
          <EntryRow
            icon={ClipboardList}
            label="服药记录"
            hint="查询与导出"
            onPress={() => router.push("/records")}
          />
          <View className="border-b border-border" />
          <EntryRow
            icon={SettingsIcon}
            label="设置"
            hint="字号与界面"
            onPress={() => router.push("/settings")}
          />
        </CardContent>
      </Card>

      <View className="mt-5 flex-row items-start gap-2 rounded-xl border-2 border-risk-l3 bg-risk-l3-tint p-3">
        <Icon as={AlertTriangle} size={18} color={riskL3} />
        <Text className="flex-1 text-xs leading-5 text-risk-l3">
          仅供产品测试：使用 Mock 药品与说明书数据（演示抄录，未经医学审核），不用于真实诊疗、处方或用药决策。
        </Text>
      </View>
    </ScrollView>
  );
}

/** 列表入口行（web 的 EntryLink）：图标 tile + 标签/副文案 + 右箭头，整行可点、触控 ≥44px。 */
function EntryRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
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
        <Text className="text-xs text-muted-foreground">{hint}</Text>
      </View>
      <Icon as={ChevronRight} size={20} color={mutedForeground} />
    </Pressable>
  );
}
