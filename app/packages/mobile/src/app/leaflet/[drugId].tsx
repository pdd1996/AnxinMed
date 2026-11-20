import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ShieldAlert } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { fetchLeaflet } from "@anxin/core";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * 说明书分段落页（2026-11-20）——咨询卡「查看完整说明书」入口的移动端落地页。
 *
 * - 数据：GET /api/drugs/:id/leaflet（userId 隔离；未收录/越权 404 可见不静默）；
 * - 分段折叠：默认展开「适应症 / 禁忌」；用法用量段固定为医嘱提示（不含剂量数字）；
 * - 未核验说明书顶部固定 banner（与咨询卡同文案）。
 */
export default function LeafletScreen() {
  const { drugId } = useLocalSearchParams<{ drugId: string }>();
  const [openKeys, setOpenKeys] = useState<string[]>(["indication", "contraindication"]);
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const riskL2 = useUnstableNativeVariable("--risk-l2");

  const { data, isLoading, error } = useQuery({
    queryKey: ["leaflet", drugId],
    queryFn: () => fetchLeaflet(drugId ?? ""),
    enabled: Boolean(drugId),
  });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-background p-4">
        <ActivityIndicator size="small" color={mutedForeground} />
        <Text className="text-sm text-muted-foreground">正在加载说明书…</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View className="flex-1 gap-3 bg-background p-4">
        <View className="rounded-2xl border border-risk-l3 bg-risk-l3-tint p-4">
          <Text className="text-base font-semibold text-card-foreground">说明书加载失败</Text>
          <Text className="mt-1 text-sm leading-5 text-muted-foreground">
            {error instanceof Error ? error.message : "本地说明书库未收录该药的说明书"}
          </Text>
          <Text className="mt-2 text-sm leading-5 text-muted-foreground">
            可返回药箱查看该药资料，或咨询医生、药师。
          </Text>
        </View>
      </View>
    );
  }

  const toggle = (key: string) =>
    setOpenKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="gap-4 p-4 pb-8">
        <View className="gap-1">
          <Text className="text-xl font-bold text-card-foreground">{data.genericName}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">
            {[data.specification, data.form, data.approvalNumbers?.join("、")]
              .filter(Boolean)
              .join(" · ") || "规格/批准文号未标注"}
          </Text>
        </View>

        <View className="gap-1 rounded-xl border border-border bg-muted p-3">
          <Text className="text-xs leading-5 text-muted-foreground">
            来源：{data.source}
            {data.version ? `（版本 ${data.version}）` : ""}
          </Text>
          <Text className="text-xs leading-5 text-muted-foreground">
            核验状态：{data.reviewed ? "已人工核验" : "未人工核验"}
          </Text>
        </View>

        {data.notice ? (
          <View className="flex-row items-start gap-1.5 rounded-xl border border-risk-l2 bg-risk-l2-tint p-3">
            <Icon as={ShieldAlert} size={16} color={riskL2} />
            <Text className="flex-1 text-sm leading-5 text-risk-l2">{data.notice}</Text>
          </View>
        ) : null}

        <View className="gap-2">
          {data.sections.map((section) => {
            const open = openKeys.includes(section.key);
            return (
              <View
                key={section.key}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => toggle(section.key)}
                  className="min-h-[44px] flex-row items-center justify-between gap-2 px-3 py-2.5 active:opacity-80"
                >
                  <Text className="text-base font-semibold text-card-foreground">
                    {section.title}
                  </Text>
                  <Icon as={open ? ChevronUp : ChevronDown} size={18} color={mutedForeground} />
                </Pressable>
                {open ? (
                  <Text
                    className={cn(
                      "border-t border-border px-3 py-3 text-base leading-6 text-card-foreground",
                      section.key === "dosage" && "text-muted-foreground",
                    )}
                  >
                    {section.body}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>

        <Text className="text-xs leading-5 text-muted-foreground">
          用法用量段为医嘱提示，本页不提供剂量数字；具体用药请咨询医生或药师。说明书内容以药品包装内说明书为准。
        </Text>
      </View>
    </ScrollView>
  );
}
