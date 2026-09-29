import "../global.css";

import { Stack } from "expo-router";
import { Toaster } from "@/components/ui/sonner-native";
import { wireMobilePlatform } from "@/lib/wiring";

// 平台装配必须先于渲染：core 的 API 基址与错误提示在本端注入（M5-T2 接缝）。
wireMobilePlatform();

export default function RootLayout() {
  return (
    <>
      <Stack
        screenOptions={{
          headerTitleAlign: "center",
          headerTitleStyle: { fontWeight: "600" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "安心用药" }} />
        <Stack.Screen name="intake" options={{ title: "拍照录入" }} />
        <Stack.Screen name="box" options={{ title: "我的药箱" }} />
        <Stack.Screen name="probe" options={{ title: "网络探测" }} />
        <Stack.Screen name="drafts/[id]" options={{ title: "草稿确认" }} />
      </Stack>
      <Toaster />
    </>
  );
}
