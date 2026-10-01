import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 未匹配路由兜底（M5-T5e，照 web `routes/patient/NotFound.tsx`）：
 * expo-router 默认会渲染它自己的 Unmatched 界面，这里换成中文页——
 * 完成标准是「访问不存在路由不再白屏」，所以必须给得出路（回今日任务），不止给个标题。
 */
export default function NotFound() {
  const router = useRouter();
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 }}
    >
      <View className="gap-1">
        <Text className="text-xs font-bold uppercase tracking-[2px] text-primary">安心用药</Text>
        <Text className="text-2xl font-bold text-foreground">页面不存在</Text>
      </View>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="text-lg">找不到该路由</CardTitle>
        </CardHeader>
        <CardContent className="gap-3">
          <Text className="text-base leading-6 text-muted-foreground">
            你访问的地址没有对应页面。可返回今日任务重新开始。
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/")}
            className="min-h-[52px] items-center justify-center rounded-xl border border-border bg-card active:opacity-80"
          >
            <Text className="text-lg font-medium text-card-foreground">回到今日任务</Text>
          </Pressable>
        </CardContent>
      </Card>
    </ScrollView>
  );
}
