import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";

type Status = "idle" | "loading" | "ok" | "fail";

const STATUS_TEXT: Record<Status, string> = {
  idle: "未探测",
  loading: "探测中…",
  ok: "连通",
  fail: "不通",
};

const STATUS_CLASS: Record<Status, string> = {
  idle: "text-muted-foreground",
  loading: "text-blue-600",
  ok: "text-green-600",
  fail: "text-red-600",
};

export default function Index() {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState("");

  async function probe() {
    if (!apiUrl) {
      setStatus("fail");
      setDetail("EXPO_PUBLIC_API_URL 未配置（检查 .env.local）");
      return;
    }
    setStatus("loading");
    setDetail("");
    const started = Date.now();
    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/health`, {
        cache: "no-store",
      });
      const ms = Date.now() - started;
      if (res.ok) {
        setStatus("ok");
        setDetail(`HTTP ${res.status}，耗时 ${ms}ms`);
      } else {
        setStatus("fail");
        setDetail(`HTTP ${res.status}，耗时 ${ms}ms`);
      }
    } catch (e) {
      setStatus("fail");
      setDetail(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    probe();
  }, []);

  return (
    <View className="flex-1 bg-background px-5 pt-4">
      <Text className="text-2xl font-semibold text-foreground">网络探测</Text>
      <Text className="mt-2 text-base text-muted-foreground" numberOfLines={2}>
        API 地址：{apiUrl ?? "未配置"}
      </Text>

      <View className="mt-6 rounded-2xl border border-border bg-card p-5">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg text-card-foreground">/api/health</Text>
          <View className="flex-row items-center gap-2">
            {status === "loading" && <ActivityIndicator size="small" />}
            <Text className={`text-lg font-semibold ${STATUS_CLASS[status]}`}>
              {STATUS_TEXT[status]}
            </Text>
          </View>
        </View>
        {!!detail && (
          <Text className="mt-3 text-base text-muted-foreground">{detail}</Text>
        )}
      </View>

      <Pressable
        onPress={probe}
        className="mt-6 min-h-[44px] items-center justify-center rounded-xl bg-primary active:opacity-80"
      >
        <Text className="text-lg font-medium text-primary-foreground">
          重新探测
        </Text>
      </Pressable>

      <Stack.Screen options={{ title: "安心用药" }} />
    </View>
  );
}
