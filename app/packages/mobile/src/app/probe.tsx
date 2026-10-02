import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";
import { apiBaseUrl, API_URL_MISSING_HINT, isApiConfigured } from "@/lib/wiring";

type Status = "idle" | "loading" | "ok" | "fail";

const STATUS_TEXT: Record<Status, string> = {
  idle: "未探测",
  loading: "探测中…",
  ok: "连通",
  fail: "不通",
};

const STATUS_CLASS: Record<Status, string> = {
  idle: "text-muted-foreground",
  loading: "text-risk-l2",
  ok: "text-risk-l1",
  fail: "text-risk-l4",
};

/**
 * 网络探测页（M5-T3 交付物，M5-T4 起从首页搬来，T3 真机验收仍在这一页做）：
 * 对 `<API 基址>/api/health` 发一次明文请求，作为「包体内内联的地址真的能打通」的唯一证据。
 */
export default function Probe() {
  const configured = isApiConfigured();
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState("");

  async function probe() {
    if (!configured) {
      setStatus("fail");
      setDetail(API_URL_MISSING_HINT);
      return;
    }
    setStatus("loading");
    setDetail("");
    const started = Date.now();
    try {
      const res = await fetch(`${apiBaseUrl()}/api/health`, { cache: "no-store" });
      const ms = Date.now() - started;
      setStatus(res.ok ? "ok" : "fail");
      setDetail(`HTTP ${res.status}，耗时 ${ms}ms`);
    } catch (e) {
      setStatus("fail");
      setDetail(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void probe();
  }, []);

  return (
    <View className="flex-1 bg-background px-5 pt-4">
      <Text className="text-2xl font-semibold text-foreground">网络探测</Text>
      <Text className="mt-2 text-base text-muted-foreground" numberOfLines={2}>
        API 地址：{configured ? apiBaseUrl() : "未配置"}
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
          <Text className="mt-3 text-base leading-6 text-muted-foreground">{detail}</Text>
        )}
      </View>

      <Pressable
        onPress={probe}
        className="mt-6 min-h-[44px] items-center justify-center rounded-xl bg-primary active:opacity-80"
      >
        <Text className="text-lg font-medium text-primary-foreground">重新探测</Text>
      </Pressable>

      <Stack.Screen options={{ title: "网络探测" }} />
    </View>
  );
}
