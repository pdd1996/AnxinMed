import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { MapPin, OctagonX, Phone } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import type { ConsultSections } from "@anxin/shared";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

/**
 * L4 急救引导卡（照 web `components/domain/consult/EmergencyCard.tsx` 重写渲染层）。
 * 大按钮 + 图标 + 文字并用；「立即拨打 120」走 tel: 链接（移动端一键拨号），
 * 文案照搬后端 EMERGENCY_SECTIONS，前端不二次加工。T7-d 起加专属播报按钮。
 */
export function EmergencyCard({ sections }: { sections: ConsultSections }) {
  const riskL4 = useUnstableNativeVariable("--risk-l4");
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const primaryForeground = useUnstableNativeVariable("--primary-foreground");
  const [linkError, setLinkError] = useState<string | null>(null);

  const openLink = async (url: string, hint: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError(hint);
    }
  };

  return (
    <View className="rounded-2xl border-2 border-risk-l4 bg-card p-5 shadow-lg">
      <View className="flex-row items-start gap-3">
        <Icon as={OctagonX} size={32} color={riskL4} />
        <View className="flex-1 gap-1">
          <Text className="text-xl font-bold text-risk-l4">紧急风险提示</Text>
          <Text className="text-base font-medium leading-6 text-card-foreground">
            {sections.summary}
          </Text>
        </View>
      </View>

      {sections.risks.length > 0 ? (
        <View className="mt-4 gap-1.5 rounded-xl border border-risk-l4 bg-risk-l4-tint p-3">
          {sections.risks.map((r) => (
            <View key={r} className="flex-row items-start gap-2">
              <View className="mt-2 size-2 rounded-full bg-risk-l4" />
              <Text className="flex-1 text-base leading-6 text-card-foreground">{r}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="mt-4 gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="立即拨打 120"
          onPress={() => void openLink("tel:120", "拨号没能打开，请用手机手动拨打 120。")}
          className="min-h-[56px] flex-row items-center justify-center gap-2 rounded-xl bg-primary active:opacity-80"
        >
          <Icon as={Phone} size={22} color={primaryForeground} />
          <Text className="text-lg font-bold text-primary-foreground">立即拨打 120</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查找附近急诊"
          onPress={() =>
            void openLink(
              encodeURI("https://map.baidu.com/search/急诊"),
              "地图没能打开，请手动打开地图搜索急诊。",
            )
          }
          className="min-h-[48px] flex-row items-center justify-center gap-2 rounded-xl border border-border bg-background active:opacity-80"
        >
          <Icon as={MapPin} size={18} color={mutedForeground} />
          <Text className="text-base font-medium text-foreground">查找附近急诊</Text>
        </Pressable>
      </View>

      {linkError ? (
        <Text className="mt-3 text-sm leading-5 text-risk-l4">{linkError}</Text>
      ) : null}

      <Text className="mt-4 text-base font-medium leading-6 text-card-foreground">
        {sections.nextAction}
      </Text>
      <Text className="mt-1 text-sm leading-5 text-muted-foreground">{sections.warning}</Text>
    </View>
  );
}
