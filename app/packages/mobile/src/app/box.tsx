import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { CONFIRM_STATUS_META } from "@anxin/shared";
import { fetchDrugs } from "@anxin/core";

/**
 * 药箱最简列表（M5-T4 完成标准第 1 条的后半段：入箱后要看得见）。
 * 完整五页移植（含计划弹窗、手动建档表单、fontScale、导出）在 M5-T5。
 */
type BoxState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: Awaited<ReturnType<typeof fetchDrugs>> };

export default function Box() {
  const router = useRouter();
  const [state, setState] = useState<BoxState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", items: await fetchDrugs() });
    } catch (error) {
      // 禁静默吞错：core 已 toast（ApiNotifier），这里再落一张可见错误卡，给出重试。
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "读取药箱失败",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: 16 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text className="text-xs font-bold uppercase tracking-[2px] text-primary">药箱</Text>
      <Text className="mt-1 text-2xl font-bold text-foreground">我的药箱</Text>

      {state.kind === "loading" && (
        <Text className="mt-6 text-base text-muted-foreground">正在读取…</Text>
      )}

      {state.kind === "error" && (
        <View className="mt-6 rounded-2xl border border-red-300 bg-red-50 p-5">
          <Text className="text-lg font-semibold text-red-800">药箱读取失败</Text>
          <Text className="mt-1 text-sm leading-5 text-red-700">{state.message}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            className="mt-4 min-h-[48px] items-center justify-center rounded-xl bg-primary active:opacity-80"
          >
            <Text className="text-lg font-medium text-primary-foreground">重试</Text>
          </Pressable>
        </View>
      )}

      {state.kind === "ready" && state.items.length === 0 && (
        <View className="mt-6 rounded-2xl border border-dashed border-border p-6">
          <Text className="text-lg font-semibold text-foreground">药箱还是空的</Text>
          <Text className="mt-1 text-sm leading-5 text-muted-foreground">
            拍一张药盒正面就能建档：识别出的药名与规格由你逐项核对后才进箱。
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/intake")}
            className="mt-4 min-h-[48px] items-center justify-center rounded-xl bg-primary active:opacity-80"
          >
            <Text className="text-lg font-medium text-primary-foreground">去拍照</Text>
          </Pressable>
        </View>
      )}

      {state.kind === "ready" &&
        state.items.map((drug) => (
          <View
            key={drug.id}
            className="mt-3 rounded-2xl border border-border bg-card p-4"
          >
            <Text className="text-xl font-semibold text-card-foreground">
              {drug.genericName}
            </Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              {[drug.brandName, drug.specification, drug.form]
                .filter((v): v is string => Boolean(v))
                .join(" · ") || "规格/剂型未记录"}
            </Text>
            <View className="mt-3 flex-row flex-wrap items-center gap-2">
              <Pill
                text={CONFIRM_STATUS_META[drug.confirmStatus]?.label ?? drug.confirmStatus}
                hint={CONFIRM_STATUS_META[drug.confirmStatus]?.hint}
              />
              {drug.stock ? <Pill text={`库存 ${drug.stock.value}${drug.stock.unit}`} /> : null}
              {drug.expiry ? <Pill text={`效期 ${drug.expiry}`} /> : null}
            </View>
          </View>
        ))}

      {state.kind === "ready" && state.items.length > 0 && (
        <Text className="mt-4 text-xs text-muted-foreground">
          共 {state.items.length} 种药。服药计划与提醒在 M5-T5 / M5-T8 接入。
        </Text>
      )}
    </ScrollView>
  );
}

function Pill({ text, hint }: { text: string; hint?: string }) {
  return (
    <View className="rounded-full bg-secondary px-3 py-1">
      <Text className="text-xs font-semibold text-secondary-foreground" accessibilityLabel={hint}>
        {text}
      </Text>
    </View>
  );
}
