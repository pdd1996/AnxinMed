import { Tabs } from "expo-router";
import {
  Bot,
  Box,
  Camera,
  CircleUserRound,
  Home,
} from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { Text as RNText, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FONT_ROOT_DP } from "@/components/FontScaleSync";
import { useFontScale } from "@/stores/fontScale";

/**
 * 患者端五槽底部导航（今日/药箱/录入/咨询/我的，2026-10-25 用户重新裁定：
 * 录入与咨询回到一级入口，记录/设置收回「我的」）。
 * 选中态不单靠颜色：实色 primary 胶囊（形状）+ 700/500 字重 + primary/muted 颜色三件套。
 * 录入 tab 只装上传步；照片选定后走根 stack 的 /intake/flow 全屏跑识别，底部导航不在。
 */
export default function PatientTabsLayout() {
  const scale = useFontScale((s) => s.scale);
  const insets = useSafeAreaInsets();
  // 与 web 同比例：标签 text-xs=0.75rem、图标 size-6=1.5rem，rem 根随字号档变（05d §6 第 2 条）。
  const root = FONT_ROOT_DP[scale];
  // 图标与 tabBar 不是 Text，套不了 className 令牌，只能读 global.css 的 CSS 变量（随系统深浅色翻转）。
  const primary = useUnstableNativeVariable("--primary");
  const primaryForeground = useUnstableNativeVariable("--primary-foreground");
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const background = useUnstableNativeVariable("--background");
  const border = useUnstableNativeVariable("--border");

  const iconSize = Math.round(root * 1.5);
  const labelSize = Math.round(root * 0.75);
  // 胶囊按档位算，避免大字号档下图标溢出胶囊。
  const pillHeight = iconSize + 8;
  const pillWidth = iconSize + 32;
  // 条高 = 内容区（胶囊 + 标签行 + item 上下 5dp）＋ 少量余量；insets.bottom 是在此之上的系统手势条。
  const barContentHeight = root === FONT_ROOT_DP.large ? 68 : 62;

  const icon =
    (Icon: typeof Home) =>
    ({ focused }: { focused: boolean }) => (
      <View
        style={{
          width: pillWidth,
          height: pillHeight,
          borderRadius: pillHeight / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: focused ? primary : "transparent",
        }}
      >
        <Icon
          size={iconSize}
          color={focused ? primaryForeground : mutedForeground}
        />
      </View>
    );

  return (
    // 顶部安全区：五个 tab 页都从状态栏下面开始（statusBarTranslucent 下否则标题会压到时间/通知上）。
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: background }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: primary,
          tabBarInactiveTintColor: mutedForeground,
          tabBarHideOnKeyboard: true,
          tabBarItemStyle: { justifyContent: "center" },
          tabBarIconStyle: { width: pillWidth, height: pillHeight },
          tabBarStyle: {
            height: barContentHeight + insets.bottom,
            backgroundColor: background,
            borderTopColor: border,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
          // 标签字重按 focused 分档：labelStyle 对五项一视同仁，做不出「选中加粗」。
          tabBarLabel: ({ focused, color, children }) => (
            <RNText
              numberOfLines={1}
              allowFontScaling={false}
              style={{
                fontSize: labelSize,
                lineHeight: Math.round(labelSize * 1.35),
                fontWeight: focused ? "700" : "500",
                color,
              }}
            >
              {children}
            </RNText>
          ),
        }}
      >
        <Tabs.Screen name="index" options={{ title: "今日", tabBarIcon: icon(Home) }} />
        <Tabs.Screen name="box" options={{ title: "药箱", tabBarIcon: icon(Box) }} />
        <Tabs.Screen name="intake" options={{ title: "录入", tabBarIcon: icon(Camera) }} />
        <Tabs.Screen name="consult" options={{ title: "咨询", tabBarIcon: icon(Bot) }} />
        <Tabs.Screen
          name="profile"
          options={{ title: "我的", tabBarIcon: icon(CircleUserRound) }}
        />
      </Tabs>
    </View>
  );
}
