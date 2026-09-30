import { Tabs } from "expo-router";
import {
  Box,
  CircleUserRound,
  ClipboardList,
  Home,
  Settings,
} from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import type { ColorValue } from "react-native";
import { FONT_ROOT_DP } from "@/components/FontScaleSync";
import { useFontScale } from "@/stores/fontScale";

/**
 * 患者端五槽底部导航（今日/药箱/记录/我的/设置，标签集按 05d §0.1 裁定；形态对齐 web BottomNav）：
 * 图标 + 文字并用、当前项不单靠颜色区分（色 + 字重）。
 * 录入 / 草稿确认 / 网络探测走根 stack push（分组外的全屏屏），与 web 的 /intake、/drafts 一致。
 */
export default function PatientTabsLayout() {
  const scale = useFontScale((s) => s.scale);
  // 与 web 同比例：标签 text-xs=0.75rem、图标 size-6=1.5rem，rem 根随字号档变（05d §6 第 2 条）。
  const root = FONT_ROOT_DP[scale];
  // 图标与 tabBar 不是 Text，套不了 className 令牌，只能读 global.css 的 CSS 变量（随系统深浅色翻转）：
  // 写死浅色值会在深色下白底白字（05d §6 第 16 条）。
  const foreground = useUnstableNativeVariable("--foreground");
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const background = useUnstableNativeVariable("--background");

  const icon =
    (Icon: typeof Home) =>
    ({ color }: { color: ColorValue }) => (
      <Icon size={Math.round(root * 1.5)} color={color} />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarLabelStyle: { fontSize: Math.round(root * 0.75), fontWeight: "600" },
        tabBarActiveTintColor: foreground,
        tabBarInactiveTintColor: mutedForeground,
        tabBarStyle: { backgroundColor: background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "今日", tabBarIcon: icon(Home) }} />
      <Tabs.Screen name="box" options={{ title: "药箱", tabBarIcon: icon(Box) }} />
      <Tabs.Screen
        name="records"
        options={{ title: "记录", tabBarIcon: icon(ClipboardList) }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "我的", tabBarIcon: icon(CircleUserRound) }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "设置", tabBarIcon: icon(Settings) }}
      />
    </Tabs>
  );
}
