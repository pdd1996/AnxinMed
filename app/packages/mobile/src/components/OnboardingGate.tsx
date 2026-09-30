import { useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useUnstableNativeVariable } from "nativewind";
import { ShieldAlert } from "lucide-react-native";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** 与 web 同键同值（web/src/components/OnboardingGate.tsx:12,21,49）：'1' 表示已确认。 */
const KEY = "anxin-onboarded";

/**
 * 首次使用引导（PRD §7.1.1）：能力边界与免责声明，确认后才进入。仅前端状态。
 * 与 web 的差异只在存储：localStorage → AsyncStorage（读是异步的，未读到时不渲染主内容，
 * 免得先闪一下 app 再弹声明卡）。声明卡文案逐字照搬 web，禁止另写一套话术。
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const [confirmed, setConfirmed] = useState<boolean>();
  // 品牌色圆底上的图标色：图标是 SVG，套不了 class，直接取 --primary-foreground（随深浅色翻转）。
  const iconOnPrimary = useUnstableNativeVariable("--primary-foreground");

  useEffect(() => {
    let alive = true;
    void AsyncStorage.getItem(KEY).then((value) => {
      if (alive) setConfirmed(value === "1");
    });
    return () => {
      alive = false;
    };
  }, []);

  if (confirmed === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-base text-muted-foreground">正在启动…</Text>
      </View>
    );
  }

  if (confirmed) return <>{children}</>;

  function agree() {
    void AsyncStorage.setItem(KEY, "1");
    setConfirmed(true);
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ alignItems: "center", flexGrow: 1, justifyContent: "center", padding: 16 }}
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <View className="mb-2 h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <ShieldAlert size={24} color={iconOnPrimary} importantForAccessibility="no" />
          </View>
          <CardTitle className="text-xl">欢迎使用安心用药</CardTitle>
          <CardDescription>首次使用前，请了解产品能力边界与免责声明。</CardDescription>
        </CardHeader>
        <CardContent className="gap-2">
          <View className="gap-2">
            <Bullet>本工具帮你把各来源的药放进同一个药箱，管理依从、相互作用提示与效期。</Bullet>
            <Bullet>
              它<Text className="font-bold text-foreground">不做诊断</Text>
              、不替代医生或药师；所有用药决定请以医嘱与说明书为准。
            </Bullet>
            <Bullet>AI 回答仅基于已确认的说明书资料；涉及停换药或剂量调整会建议你咨询医生。</Bullet>
            <Bullet>提醒仅在页面打开期间生效；漏服不会自动建议补服。</Bullet>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={agree}
            className="mt-2 min-h-[48px] items-center justify-center rounded-xl bg-primary active:opacity-80"
          >
            <Text className="text-lg font-medium text-primary-foreground">我已了解并同意</Text>
          </Pressable>
        </CardContent>
      </Card>
    </ScrollView>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row gap-2">
      <Text className="text-sm text-muted-foreground">•</Text>
      <Text className="flex-1 text-sm leading-6 text-muted-foreground">{children}</Text>
    </View>
  );
}
