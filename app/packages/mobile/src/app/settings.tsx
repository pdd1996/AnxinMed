import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useUnstableNativeVariable } from "nativewind";
import { Type, Bell, Wifi } from "lucide-react-native";
import { RiskBadge } from "@/components/domain/RiskBadge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
// Text 必须走 ui/text：09-30 深夜修过一条「settings.tsx 直引 react-native 的 Text，接不到
// TextClassContext 下发的颜色」（commit 7b35934），T5-e 重写本页时又退回去了——深色下选中档
// 文字实测黑压黑。见 T5-真机验收.md §2.10。
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { useFontScale, type FontScale } from "@/stores/fontScale";
import { useReminderSync } from "@/stores/reminderSync";

/**
 * 设置页（M5-T5e 起为真实页）：字号两档 = 全局缩放的验证入口，风险语义色预览 = §6 第 4 条的色板自检。
 * 档位经 core 的 store + AsyncStorage 持久化，切换即时写入 NativeWind 的 rem 根（见 FontScaleSync）。
 */
export default function Settings() {
  const router = useRouter();
  const scale = useFontScale((s) => s.scale);
  const setScale = useFontScale((s) => s.setScale);
  const reminderPermission = useReminderSync((s) => s.permission);
  // 图标是 SVG，取 --primary 令牌而不是写死色值（深浅色都要对，05d §6 第 16 条）。
  const primary = useUnstableNativeVariable("--primary");

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingBottom: 40,
        paddingTop: 16,
      }}
    >
      {/* 页面标题由根 stack 头部给（「设置」），页内小标题只负责本页的主张。 */}
      <Text className="text-2xl font-bold text-foreground">看得清，才用得住</Text>

      <View className="mt-6 gap-3">
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

      <View className="mt-8 gap-3">
        <Text className="text-base font-bold text-foreground">风险语义色预览</Text>
        <Text className="text-sm leading-6 text-muted-foreground">
          图标 + 文字并用，不单靠颜色（守门 L1–L4，L4 最高）。
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <RiskBadge level="L1" />
          <RiskBadge level="L2" />
          <RiskBadge level="L3" />
          <RiskBadge level="L4" />
        </View>
      </View>

      <View className="mt-8 gap-2">
        <Text className="text-lg font-semibold text-foreground">服务器连接</Text>
        <Text className="text-sm leading-6 text-muted-foreground">
          连不上时，先在这里检查这台设备的网络与服务器地址。
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/probe")}
          className="mt-1 min-h-[52px] flex-row items-center gap-3 rounded-xl border border-border bg-card px-4 active:opacity-80"
        >
          <Wifi size={20} color={primary} importantForAccessibility="no" />
          <Text className="flex-1 text-base font-medium text-card-foreground">网络探测</Text>
          <Text className="text-sm text-muted-foreground">去检查 →</Text>
        </Pressable>
      </View>

      <View className="mt-8 gap-2">
        <Text className="text-lg font-semibold text-foreground">到点提醒</Text>
        <Text className="text-sm leading-6 text-muted-foreground">
          退到后台或关闭应用后，到点由系统通知提醒。
          {reminderPermission === "granted"
            ? "通知权限已开启。"
            : "通知权限还没开启，到点提醒不会响。"}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/notification-settings")}
          className="mt-1 min-h-[52px] flex-row items-center gap-3 rounded-xl border border-border bg-card px-4 active:opacity-80"
        >
          <Bell size={20} color={primary} importantForAccessibility="no" />
          <Text className="flex-1 text-base font-medium text-card-foreground">通知与提醒设置</Text>
          <Text className="text-sm text-muted-foreground">
            {reminderPermission === "granted" ? "去检查 →" : "去开启 →"}
          </Text>
        </Pressable>
      </View>

      <View className="mt-8 gap-2">
        <Text className="text-base font-bold text-foreground">界面深浅色</Text>
        <Text className="text-sm leading-6 text-muted-foreground">
          跟随手机的系统深浅色设置，切换后立即生效，不需要重启应用。
        </Text>
      </View>
    </ScrollView>
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
      <Text
        className={cn(
          "text-base font-semibold",
          // 一元素只挂一条颜色类：两条同类颜色类在 RN 侧谁赢由 CSS 产出顺序定，不按 class 书写顺序（§2.10 实测）
          active ? "text-primary-foreground" : "text-secondary-foreground"
        )}
      >
        {label}
      </Text>
    </TabsTrigger>
  );
}
