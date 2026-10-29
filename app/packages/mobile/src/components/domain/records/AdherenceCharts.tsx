import { useMemo, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useUnstableNativeVariable } from "nativewind";
import { BarChart } from "react-native-gifted-charts";
import { fetchMyAdherenceSeries, type MyAdherenceSeriesDto } from "@anxin/core";
import { useFontScale } from "@/stores/fontScale";

const DAY_OPTIONS = [7, 30] as const;

/** 页面 px-5(20) ×2 + 卡片 p-4(16) ×2：图表可用宽度。 */
const CARD_H_PADDING = 72;

type Series = MyAdherenceSeriesDto["series"];
type ByDrug = MyAdherenceSeriesDto["byDrug"];
type Palette = { taken: string; skipped: string; later: string; muted: string };

/** 图例与堆叠顺序（照 web：已服/漏服/延后，顺序即堆叠顺序）。 */
const KINDS = ["已服", "漏服", "延后"] as const;

/** 堆叠柱：空值补 0，跨天标签每 7 天一个（30 天全标会糊成一片）。 */
export function buildDailyStackData(series: Series, palette: Palette, labelFontSize: number) {
  const step = series.length > 10 ? 7 : 1;
  return series.map((d, i) => ({
    label: i % step === 0 || i === series.length - 1 ? d.date.slice(5) : "",
    labelWidth: 32,
    labelsDistanceFromXaxis: 6,
    labelTextStyle: { fontSize: labelFontSize, color: palette.muted },
    stacks: [
      { value: d.taken, color: palette.taken },
      { value: d.skipped, color: palette.skipped },
      { value: d.later, color: palette.later },
    ],
  }));
}

/** 应服虚线：与柱同点数同序，逐日对应。全零时不画（避免一条贴地线被误读成「应服为 0」之外的含义）。 */
export function buildExpectedLine(series: Series) {
  if (!series.some((d) => d.expected > 0)) return null;
  return series.map((d) => ({ value: d.expected }));
}

/** 按药品水平堆叠：药名过长时截断（图表区只有 ~96dp 给标签）。 */
export function buildByDrugStackData(byDrug: ByDrug, palette: Palette, labelFontSize: number) {
  return byDrug.map((d) => ({
    label: d.genericName.length > 6 ? `${d.genericName.slice(0, 6)}…` : d.genericName,
    labelWidth: 92,
    labelTextStyle: { fontSize: labelFontSize, color: palette.muted },
    stacks: [
      { value: d.taken, color: palette.taken },
      { value: d.skipped, color: palette.skipped },
      { value: d.later, color: palette.later },
    ],
  }));
}

/** 柱子宽度与间距按点数摊开（7 天粗柱、30 天细柱），保证 360dp 屏不横向溢出。 */
export function layoutBars(chartWidth: number, count: number) {
  const barWidth = count <= 10 ? 16 : 4;
  const spacing = count > 1 ? Math.max(2, (chartWidth - 24 - count * barWidth) / (count - 1)) : 0;
  return { barWidth, spacing };
}

/** y 轴上限取 3 的倍数 → noOfSections=3 时刻度为整数，不出现 0.33 这种刻度。 */
export function niceMax(series: Series, byDrug: ByDrug) {
  const peak = Math.max(
    1,
    ...series.map((d) => Math.max(d.taken + d.skipped + d.later, d.expected)),
    ...byDrug.map((d) => d.taken + d.skipped + d.later),
  );
  return Math.ceil(peak / 3) * 3;
}

/** 三色图例（gifted-charts 柱状图无内建图例，照 web 的 legend 内容手排一行）。 */
function Legend({ palette }: { palette: Palette }) {
  const entries = [palette.taken, palette.skipped, palette.later];
  return (
    <View className="flex-row flex-wrap items-center gap-4">
      {KINDS.map((kind, i) => (
        <View key={kind} className="flex-row items-center gap-1.5">
          <View className="size-3 rounded-full" style={{ backgroundColor: entries[i] }} />
          <Text className="text-sm text-muted-foreground">{kind}</Text>
        </View>
      ))}
      <View className="flex-row items-center gap-1.5">
        <View className="h-0.5 w-4 border-t-2 border-dashed border-muted-foreground" />
        <Text className="text-sm text-muted-foreground">应服</Text>
      </View>
    </View>
  );
}

/**
 * 打卡趋势图表卡（M5-T9 · 照 web `insight/PatientAdherenceCharts` 的两张图）。
 *
 * 数据 `GET /api/records/adherence-series`（0 次 LLM 直查库，patientId 由服务端从会话派生）。
 * 图表库 react-native-gifted-charts（纯 JS + 已装的 react-native-svg，不引 Skia；选型回写见 05 任务书 T9-1）。
 * 颜色全部读主题令牌（light/dark 各一套），字号随「标准/大字」两档缩放。
 * 三态可见（AGENTS.md 禁止静默吞错）：加载中 / 失败带重试 / 无记录明示。
 */
export function AdherenceCharts() {
  const { width: windowWidth } = useWindowDimensions();
  const fontScale = useFontScale((s) => s.scale);
  const labelFontSize = fontScale === "large" ? 12 : 10;
  const tickFontSize = fontScale === "large" ? 13 : 11;
  const [days, setDays] = useState<number>(30);

  const l1 = useUnstableNativeVariable("--risk-l1");
  const l3 = useUnstableNativeVariable("--risk-l3");
  const muted = useUnstableNativeVariable("--muted-foreground");
  const palette: Palette = useMemo(
    () => ({
      taken: l1 ?? "#2f7d5b",
      skipped: l3 ?? "#c2662f",
      later: muted ?? "#6b7280",
      muted: muted ?? "#6b7280",
    }),
    [l1, l3, muted],
  );

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["records", "adherence-series", days],
    queryFn: () => fetchMyAdherenceSeries(days),
  });

  const chartWidth = Math.max(220, windowWidth - CARD_H_PADDING);
  /** BarChart 的 width 是绘图区宽度（不含 y 轴标签），柱宽与间距必须按同一宽度摊。 */
  const plotWidth = chartWidth - 40;
  const series = data?.series;
  const byDrug = data?.byDrug;

  const charts = useMemo(() => {
    if (!series || !byDrug) return null;
    const daily = buildDailyStackData(series, palette, labelFontSize);
    const expected = buildExpectedLine(series);
    const perDrug = buildByDrugStackData(byDrug, palette, labelFontSize);
    const dailyLayout = layoutBars(plotWidth, daily.length);
    const drugLayout = layoutBars(Math.max(90, plotWidth - 96), Math.max(1, perDrug.length));
    return { daily, expected, perDrug, dailyLayout, drugLayout, maxValue: niceMax(series, byDrug) };
  }, [series, byDrug, palette, labelFontSize, plotWidth]);

  return (
    <View className="mt-4 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-lg font-semibold text-card-foreground">打卡趋势</Text>
        <View className="flex-row gap-2" accessibilityRole="radiogroup" accessibilityLabel="统计窗口">
          {DAY_OPTIONS.map((d) => {
            const selected = days === d;
            return (
              <Pressable
                key={d}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setDays(d)}
                className={`min-h-[44px] items-center justify-center rounded-xl px-3 ${
                  selected ? "border-2 border-primary bg-primary" : "border border-border bg-card active:opacity-80"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    selected ? "text-primary-foreground" : "text-card-foreground"
                  }`}
                >
                  近 {d} 天
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {isPending ? (
        <Text className="mt-4 text-base text-muted-foreground">正在加载打卡数据…</Text>
      ) : error ? (
        <View className="mt-4 rounded-xl border border-risk-l4 bg-risk-l4-tint p-4">
          <Text className="text-base font-semibold text-risk-l4">打卡数据加载失败</Text>
          <Text className="mt-1 text-sm leading-5 text-risk-l4">
            {error instanceof Error ? error.message : "请求没能完成"}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void refetch()}
            className="mt-3 min-h-[48px] items-center justify-center rounded-xl bg-primary active:opacity-80"
          >
            <Text className="text-base font-medium text-primary-foreground">重试</Text>
          </Pressable>
        </View>
      ) : series && series.length > 0 && charts ? (
        <>
          <View className="mt-3">
            <Legend palette={palette} />
          </View>

          <View
            className="mt-2"
            accessible
            accessibilityRole="image"
            accessibilityLabel={`近 ${days} 天按日打卡堆叠柱状图，虚线为当日应服次数`}
          >
            <BarChart
              data={charts.daily}
              {...charts.dailyLayout}
              width={plotWidth}
              height={200}
              initialSpacing={12}
              endSpacing={12}
              barBorderTopLeftRadius={2}
              barBorderTopRightRadius={2}
              noOfSections={3}
              maxValue={charts.maxValue}
              yAxisLabelWidth={30}
              yAxisTextStyle={{ fontSize: tickFontSize, color: palette.muted }}
              rulesColor={palette.muted}
              rulesType="dotted"
              showLine={charts.expected !== null}
              lineData={charts.expected ?? undefined}
              lineBehindBars
              lineConfig={{
                color: palette.muted,
                thickness: 1.5,
                strokeDashArray: [4, 4],
                hideDataPoints: true,
                isAnimated: false,
                spacing: charts.dailyLayout.spacing,
                initialSpacing: 12,
              }}
              allowFontScaling={false}
            />
          </View>

          <Text className="mt-1 text-sm leading-5 text-muted-foreground">
            柱子是打卡记录（已服/漏服/延后），虚线是当天应服的次数。近 {days} 天执行率{" "}
            {data.adherence.rate}%（已服 {data.adherence.taken}/{data.adherence.total}）。
          </Text>

          {charts.perDrug.length > 0 ? (
            <View
              className="mt-4"
              accessible
              accessibilityRole="image"
              accessibilityLabel={`近 ${days} 天按药品打卡数量水平条形图`}
            >
              <Text className="mb-1 text-base font-semibold text-card-foreground">按药品看</Text>
              <BarChart
                data={charts.perDrug}
                {...charts.drugLayout}
                horizontal
                width={plotWidth}
                height={Math.max(140, charts.perDrug.length * 56)}
                initialSpacing={10}
                endSpacing={10}
                barBorderTopRightRadius={2}
                barBorderBottomRightRadius={2}
                noOfSections={3}
                maxValue={charts.maxValue}
                yAxisLabelWidth={96}
                yAxisTextStyle={{ fontSize: tickFontSize, color: palette.muted }}
                rulesColor={palette.muted}
                rulesType="dotted"
                allowFontScaling={false}
              />
            </View>
          ) : (
            <Text className="mt-4 rounded-xl border border-dashed border-border p-3 text-sm leading-5 text-muted-foreground">
              近 {days} 天还没有打卡记录，先有记录才会有按药品的统计。
            </Text>
          )}
        </>
      ) : (
        <Text className="mt-4 rounded-xl border border-dashed border-border p-4 text-base leading-6 text-muted-foreground">
          近 {days} 天还没有打卡数据。去「今日」页把到点的药打上「已服」，趋势就会出现在这里。
        </Text>
      )}
    </View>
  );
}
