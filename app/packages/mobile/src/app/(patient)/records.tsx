import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useUnstableNativeVariable } from "nativewind";
import { CalendarDays, Download } from "lucide-react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  computeRange,
  fetchRecords,
  RECORD_STATUS_LABEL,
  recordsToCsv,
  type RangeMode,
} from "@anxin/core";
import { TAB_BAR_BOTTOM_PAD } from "@/lib/layout";
import { Icon } from "@/components/ui/icon";

const MODES: { key: RangeMode; label: string }[] = [
  { key: "day", label: "按日" },
  { key: "week", label: "按周" },
  { key: "month", label: "按月" },
];

/**
 * 服药记录查询与导出（M5-T5d，照 web `routes/patient/Records.tsx`）。
 * 区间换算与 CSV 文本全在 `@anxin/core`（`computeRange`·`recordsToCsv`，已单测；CSV 首字节带
 * UTF-8 BOM 保证 Excel 不乱码）；本包只把 web 的 `Blob + a.download` 换成
 * `expo-file-system` 写进缓存目录 + `expo-sharing` 交出去（RN 没有「同源下载」这回事）。
 *
 * 三条可见性（AGENTS.md「禁止静默吞错」）：读取失败出红卡带重试；分享不可用/失败出中文说明
 * （用户主动取消分享按提示处理，不当错误）；`summary.total` 与 `items.length` 一旦不等就在页上
 * 明示——CSV 导出吃的是 items，不等就意味着导出少条（05d §7-6 那条缺陷的用户侧兜底）。
 */
export default function Records() {
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const [mode, setMode] = useState<RangeMode>("week");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const { from, to } = computeRange(mode);
  const { data, isPending, error, refetch, isRefetching } = useQuery({
    queryKey: ["records", from, to],
    queryFn: () => fetchRecords(from, to),
  });
  const items = data?.items ?? [];
  const summary = data?.summary;
  const mismatch = summary ? summary.total !== items.length : false;

  async function exportCsv() {
    setNotice(null);
    setFailure(null);
    setBusy(true);
    try {
      const name = `服药记录_${from}_${to}.csv`;
      const file = new File(Paths.cache, name);
      file.create({ overwrite: true });
      file.write(recordsToCsv(items));
      if (!(await Sharing.isAvailableAsync())) {
        setFailure(
          `文件已生成为「${name}」，但这台设备上没有可接收文件的应用，没能分享出去。`,
        );
        return;
      }
      await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "导出服药记录" });
      setNotice(`已生成 ${name}，请在系统分享面板选择去向。`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // 用户在系统面板按返回取消分享，不算失败
      if (/cancel/i.test(message)) setNotice("已取消分享。");
      else setFailure(`导出没有完成：${message || "未知原因"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingBottom: TAB_BAR_BOTTOM_PAD,
        paddingTop: 16,
      }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={mutedForeground}
        />
      }
    >
      <Text className="text-xs font-bold uppercase tracking-[2px] text-primary">服药记录</Text>
      <Text className="mt-1 text-2xl font-bold text-foreground">查询与导出</Text>
      <Text className="mt-1 text-base leading-6 text-muted-foreground">
        按日 / 周 / 月查看你亲自确认的服药留痕，可导出 CSV。
      </Text>

      <View className="mt-5 flex-row gap-2">
        {MODES.map((item) => {
          const selected = mode === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setMode(item.key)}
              className={`min-h-[52px] flex-1 items-center justify-center rounded-xl ${
                selected
                  ? "border-2 border-primary bg-primary"
                  : "border border-border bg-card active:opacity-80"
              }`}
            >
              <Text
                className={`text-base font-semibold ${
                  selected ? "text-primary-foreground" : "text-card-foreground"
                }`}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="mt-4 rounded-2xl border border-border bg-card p-4">
        {/* flex-wrap 是必需：大字档下日期串变宽，不换行会把「导出 CSV」整条挤出屏幕右边缘
            （10-03 模拟器大字档实测，按钮节点 bounds 右沿 =1080 即屏宽，「CSV」三字看不见）。
            标准档两者本来同宽一行，加 wrap 无变化。 */}
        <View className="flex-row flex-wrap items-center justify-between gap-3">
          <View className="min-w-0 flex-row items-center gap-2">
            <Icon as={CalendarDays} size={20} color={mutedForeground} />
            <Text className="text-base font-semibold text-card-foreground">
              {from} ~ {to}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={items.length === 0 || busy}
            onPress={() => void exportCsv()}
            className={`min-h-[48px] flex-row items-center gap-1.5 rounded-xl bg-primary px-3 active:opacity-80 ${
              items.length === 0 || busy ? "opacity-50" : ""
            }`}
          >
            <Icon as={Download} size={18} color={mutedForeground} />
            <Text className="text-base font-medium text-primary-foreground">
              {busy ? "生成中…" : "导出 CSV"}
            </Text>
          </Pressable>
        </View>

        {summary ? (
          <Text className="mt-3 text-sm text-muted-foreground">
            共 {summary.total} 条 · 已服 {summary.taken} · 跳过 {summary.skipped} · 稍后{" "}
            {summary.later}
          </Text>
        ) : null}

        {mismatch ? (
          <View className="mt-3 rounded-xl border border-risk-l4 bg-risk-l4-tint p-3">
            <Text className="text-sm font-semibold text-risk-l4">条数对不上</Text>
            <Text className="mt-1 text-xs leading-5 text-risk-l4">
              页顶统计 {summary?.total} 条，列表只有 {items.length} 条——导出的 CSV 按列表生成，
              可能少 {Math.max(0, (summary?.total ?? 0) - items.length)} 条。请把这条提示与区间
              （{from} ~ {to}）告知开发者。
            </Text>
          </View>
        ) : null}

        {failure ? (
          <View className="mt-3 rounded-xl border border-risk-l4 bg-risk-l4-tint p-3">
            <Text className="text-sm leading-5 text-risk-l4">{failure}</Text>
          </View>
        ) : null}
        {notice ? (
          <Text className="mt-3 text-xs leading-5 text-muted-foreground">{notice}</Text>
        ) : null}
      </View>

      {isPending ? (
        <Text className="mt-6 text-base text-muted-foreground">正在载入记录…</Text>
      ) : error ? (
        <View className="mt-4 rounded-2xl border border-risk-l4 bg-risk-l4-tint p-5">
          <Text className="text-lg font-semibold text-risk-l4">记录读取失败</Text>
          <Text className="mt-1 text-sm leading-5 text-risk-l4">
            {error instanceof Error ? error.message : "请求没能完成"}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void refetch()}
            className="mt-4 min-h-[48px] items-center justify-center rounded-xl bg-primary active:opacity-80"
          >
            <Text className="text-lg font-medium text-primary-foreground">重试</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View className="mt-4 rounded-2xl border border-dashed border-border p-6">
          <Text className="text-lg font-semibold text-foreground">该区间暂无服药记录</Text>
          <Text className="mt-1 text-sm leading-5 text-muted-foreground">
            换一档粒度，或去今日页把到点的药打上「已服」，记录就会出现在这里。
          </Text>
        </View>
      ) : (
        <View className="mt-4 gap-2">
          {items.map((record) => (
            <View
              key={record.id}
              className="flex-row items-center gap-3 rounded-xl border border-border bg-card px-3 py-3"
            >
              <Text className="shrink-0 text-sm font-semibold text-muted-foreground">
                {record.scheduledDate} {record.scheduledTime}
              </Text>
              <Text className="min-w-0 flex-1 text-base text-card-foreground" numberOfLines={1}>
                {record.drugName}
              </Text>
              <View className="shrink-0 rounded-full bg-secondary px-2 py-0.5">
                <Text className="text-xs font-semibold text-secondary-foreground">
                  {RECORD_STATUS_LABEL[record.status] ?? record.status}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <View className="mt-5 rounded-xl border border-border bg-card p-3">
        <Text className="text-xs leading-5 text-muted-foreground">
          记录为你亲自操作的留痕，非系统医学验证；库存按次扣减。如与实际用药有出入，请以医嘱为准。
        </Text>
      </View>
    </ScrollView>
  );
}
