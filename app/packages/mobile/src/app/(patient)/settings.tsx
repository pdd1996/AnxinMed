import { Text, View } from "react-native";
import { useUnstableNativeVariable } from "nativewind";
import { Type } from "lucide-react-native";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFontScale, type FontScale } from "@/stores/fontScale";

/**
 * 设置页（M5-T5a 起可用）：字号两档切换 = 全局缩放的验证入口（05d §2-T5-a 完成标准）。
 * 档位经 core 的 store + AsyncStorage 持久化，切换即时写入 NativeWind 的 rem 根（见 FontScaleSync）。
 * 风险语义色预览、提醒设置等其余项随 M5-T5e / M5-T8 接入。
 */
export default function Settings() {
  const scale = useFontScale((s) => s.scale);
  const setScale = useFontScale((s) => s.setScale);
  // 图标是 SVG，取 --primary 令牌而不是写死色值（深浅色都要对，05d §6 第 16 条）。
  const primary = useUnstableNativeVariable("--primary");

  return (
    <PlaceholderPage title="设置" route="/settings" milestone="M5-T5e">
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <Type size={20} color={primary} importantForAccessibility="no" />
          <Text className="text-base font-bold text-foreground">字号大小</Text>
        </View>
        <Text className="text-sm leading-6 text-muted-foreground">
          两档切换，即时生效并记住你的选择（退出应用重开保持）。当前：
          <Text className="font-bold text-foreground">{scale === "large" ? "大字" : "标准"}</Text>
        </Text>
        <Tabs value={scale} onValueChange={(v) => setScale(v as FontScale)}>
          <TabsList className="h-auto w-full flex-row gap-1">
            <TabOption value="normal" label="标准" active={scale === "normal"} />
            <TabOption value="large" label="大字" active={scale === "large"} />
          </TabsList>
        </Tabs>
        <Text className="text-sm leading-6 text-muted-foreground">
          改变的是整页文字与间距一起缩放，从标题到按钮、卡片内边距都会跟着变。
        </Text>
      </View>
    </PlaceholderPage>
  );
}

/** 档位选项：触控目标 ≥44px（RNR TabsTrigger 默认 h-9 容器偏矮，这里显式抬高）。 */
function TabOption({
  value,
  label,
  active,
}: {
  value: FontScale;
  label: string;
  active: boolean;
}) {
  return (
    <TabsTrigger
      value={value}
      accessibilityState={{ selected: active }}
      className="min-h-[44px] flex-1 px-6"
    >
      <Text className="text-base font-semibold">{label}</Text>
    </TabsTrigger>
  );
}
