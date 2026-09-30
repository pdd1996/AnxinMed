import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * 骨架占位页统一外壳（照搬 web/src/components/layout/PlaceholderPage 的形态）：
 * 用于验证路由可达、tab 联动、老年向令牌（字号/间距/对比）生效，并如实写明真实实现落在哪一片——
 * 不做点了没反应的假按钮（05d §2-T5-e）。
 */
export function PlaceholderPage({
  title,
  route,
  milestone,
  children,
}: {
  title: string;
  route: string;
  milestone: string;
  children?: ReactNode;
}) {
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: 16 }}
    >
      <View className="gap-1">
        <Text className="text-xs font-bold uppercase tracking-[2px] text-primary">
          安心用药 · 骨架占位
        </Text>
        <Text className="text-2xl font-bold text-foreground">{title}</Text>
      </View>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription>
            路由 {route} · 真实实现见 {milestone}
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          {children ?? (
            <Text className="text-sm leading-6 text-muted-foreground">
              本页为骨架占位，用于验证路由可达与老年向设计令牌生效。
            </Text>
          )}
        </CardContent>
      </Card>
    </ScrollView>
  );
}
