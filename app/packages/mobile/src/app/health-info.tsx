import { ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { fetchProfile } from "@anxin/core";
import { HEALTH_FIELDS } from "@anxin/shared";
import { HealthInfoCard } from "@/components/domain/profile/HealthInfoCard";

/**
 * 健康信息一级页（2026-11-18 UI 调整）：从「我的」页内嵌卡升级为与「服药记录」同级的独立页。
 * 页面负责标题/说明/补充进度；字段行与编辑弹窗仍全部复用 `HealthInfoCard`（showHeader=false），
 * 两条入口走同一份数据与同一套 PATCH 逻辑，不存在第二套真相。
 */
export default function HealthInfoPage() {
  const { data } = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const entries = data?.items ?? [];
  const filled = HEALTH_FIELDS.filter((field) =>
    entries.some((entry) => entry.fieldKey === field && entry.value?.trim()),
  ).length;
  const total = HEALTH_FIELDS.length;
  const pct = Math.round((filled / total) * 100);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
    >
      <Text className="text-2xl font-bold text-foreground">七项健康档案</Text>

      {data ? (
        <View
          className="mt-4 rounded-2xl border border-border bg-card p-4"
          accessibilityLabel={`已补充 ${filled} / ${total} 项`}
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-muted-foreground">已补充</Text>
            <Text className="text-sm font-semibold text-card-foreground">
              {filled} / {total} 项
            </Text>
          </View>
          <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <View className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </View>
        </View>
      ) : null}

      <View className="mt-4">
        <HealthInfoCard showHeader={false} />
      </View>
    </ScrollView>
  );
}
