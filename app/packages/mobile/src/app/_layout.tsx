import "../global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
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
    </QueryClientProvider>
  );
}
