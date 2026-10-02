import "../global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { PortalHost } from "@rn-primitives/portal";
import { Stack } from "expo-router";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { FontScaleSync } from "@/components/FontScaleSync";
import { OnboardingGate } from "@/components/OnboardingGate";
import { Toaster } from "@/components/ui/sonner-native";
import { queryClient } from "@/lib/query";
import { wireMobilePlatform } from "@/lib/wiring";

// 平台装配必须先于渲染：core 的 API 基址与错误提示在本端注入（M5-T2 接缝）。
wireMobilePlatform();

/**
 * 应用外壳（M5-T5a，对齐 web/src/App.tsx:18-28 的装配次序）：
 * Query → 字号档同步 → 首次使用声明卡 → 路由。
 * 五 tab 在 (patient) 分组内（无系统头部，页内自出标题）；录入 / 草稿确认 / 网络探测走根 stack 全屏 push。
 */
export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* 键盘避让的提供方：edge-to-edge 下窗口不再随输入法缩放，弹窗要靠它让出键盘高度（§6 第 14 条）。 */}
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <FontScaleSync />
        <OnboardingGate>
          <Stack
            screenOptions={{
              headerTitleAlign: "center",
              headerTitleStyle: { fontWeight: "600" },
            }}
          >
            <Stack.Screen name="(patient)" options={{ headerShown: false }} />
            <Stack.Screen name="intake" options={{ title: "拍照录入" }} />
            <Stack.Screen name="drafts/[id]" options={{ title: "草稿确认" }} />
            <Stack.Screen name="probe" options={{ title: "网络探测" }} />
          </Stack>
        </OnboardingGate>
        <Toaster />
        {/* Dialog / Sheet 的内容经 @rn-primitives/portal 的 Portal 走 zustand 挂载表，
            没有这个 host 时 Portal 直接 return null——安卓上所有弹窗都弹不出来（05d §6 第 14 条排查时实测）。
            必须在 KeyboardProvider 之内：弹窗里的键盘避让要能拿到它的上下文。 */}
        <PortalHost />
      </KeyboardProvider>
    </QueryClientProvider>
  );
}
