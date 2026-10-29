import type { ReactElement } from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetchMyAdherenceSeries } from "@anxin/core";
import {
  AdherenceCharts,
  buildByDrugStackData,
  buildDailyStackData,
  buildExpectedLine,
  layoutBars,
  niceMax,
} from "./AdherenceCharts";

/** 捕获传给 BarChart 的 props（图表库本身是原生绘制，单测只验数据映射与三态，不验像素）。 */
const chartProps: Array<Record<string, unknown>> = [];

jest.mock("react-native-gifted-charts", () => ({
  BarChart: (props: Record<string, unknown>) => {
    chartProps.push(props);
    return null;
  },
}));

jest.mock("nativewind", () => ({
  useUnstableNativeVariable: () => "#336699",
}));

jest.mock("@/stores/fontScale", () => ({
  useFontScale: (selector: (s: { scale: string }) => unknown) => selector({ scale: "normal" }),
}));

jest.mock("@anxin/core", () => ({
  fetchMyAdherenceSeries: jest.fn(),
}));

const mockedFetch = jest.mocked(fetchMyAdherenceSeries);

const palette = { taken: "#2f7d5b", skipped: "#c2662f", later: "#6b7280", muted: "#6b7280" };

/** mockResolvedValue 要的是 core 函数的原始返回（含 ok），组件侧用的是去掉 ok 的 DTO。 */
type SeriesResponse = Awaited<ReturnType<typeof fetchMyAdherenceSeries>>;

function makeData(days: number): SeriesResponse {
  return {
    ok: true,
    patientId: "p-001",
    days,
    startDate: "2026-10-20",
    endDate: "2026-10-26",
    series: Array.from({ length: days }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      taken: i % 3 === 0 ? 2 : 0,
      skipped: i % 3 === 1 ? 1 : 0,
      later: i % 3 === 2 ? 1 : 0,
      expected: 2,
    })),
    byDrug: [{ genericName: "玻璃酸钠滴眼液", brandName: "海露", taken: 7, skipped: 3, later: 2 }],
    adherence: { rate: 58, taken: 7, skipped: 3, total: 12 },
  };
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  chartProps.length = 0;
  mockedFetch.mockReset();
});

describe("AdherenceCharts · 数据映射（纯函数）", () => {
  it("按日堆叠：三态各成一段、顺序已服/漏服/延后，标签每 7 天一个", () => {
    const stack = buildDailyStackData(makeData(30).series, palette, 10);
    expect(stack).toHaveLength(30);
    expect(stack[0].stacks.map((s) => s.value)).toEqual([2, 0, 0]);
    expect(stack[1].stacks.map((s) => s.value)).toEqual([0, 1, 0]);
    expect(stack[2].stacks.map((s) => s.value)).toEqual([0, 0, 1]);
    expect(stack[0].label).toBe("10-01");
    expect(stack[1].label).toBe("");
    expect(stack[7].label).toBe("10-08");
    expect(stack[29].label).toBe("10-30");
  });

  it("按日堆叠：7 天窗口每天都有标签", () => {
    const stack = buildDailyStackData(makeData(7).series, palette, 10);
    expect(stack.every((d) => d.label !== "")).toBe(true);
  });

  it("应服虚线：全零不画，非零逐日对齐", () => {
    expect(buildExpectedLine(makeData(7).series)).toHaveLength(7);
    const zero = makeData(7).series.map((d) => ({ ...d, expected: 0 }));
    expect(buildExpectedLine(zero)).toBeNull();
  });

  it("按药品水平堆叠：药名超 6 字截断，三态保留", () => {
    const rows = buildByDrugStackData(makeData(7).byDrug, palette, 10);
    expect(rows[0].label).toBe("玻璃酸钠滴眼…");
    expect(rows[0].stacks.map((s) => s.value)).toEqual([7, 3, 2]);
  });

  it("柱宽与间距：30 天用细柱、7 天用粗柱，且不超绘图宽", () => {
    const wide = layoutBars(248, 7);
    const narrow = layoutBars(248, 30);
    expect(wide.barWidth).toBe(16);
    expect(narrow.barWidth).toBe(4);
    for (const { barWidth, spacing } of [wide, narrow]) {
      expect(barWidth * 7 + spacing * 6).toBeLessThanOrEqual(248);
    }
  });

  it("y 轴上限取 3 的倍数（整数刻度）", () => {
    expect(niceMax(makeData(7).series, makeData(7).byDrug)).toBe(12);
    const single = makeData(1);
    expect(niceMax(single.series, [])).toBe(3);
  });
});

describe("AdherenceCharts · 三态", () => {
  it("加载中：中文提示可见", async () => {
    mockedFetch.mockReturnValue(new Promise(() => {}));
    const view = await renderWithQuery(<AdherenceCharts />);
    expect(view.getByText("正在加载打卡数据…")).toBeTruthy();
  });

  it("成功：默认 30 天，两张图与执行率脚注齐出", async () => {
    mockedFetch.mockResolvedValue(makeData(30));
    const view = await renderWithQuery(<AdherenceCharts />);

    await waitFor(() => expect(view.getByText(/执行率/)).toBeTruthy());
    expect(mockedFetch).toHaveBeenCalledWith(30);
    expect(view.getByText(/58%（已服 7\/12）/)).toBeTruthy();
    expect(view.getByText("打卡趋势")).toBeTruthy();

    const daily = chartProps[0];
    expect((daily.data as unknown[]).length).toBe(30);
    expect(daily.showLine).toBe(true);
    expect((daily.lineConfig as { strokeDashArray: number[] }).strokeDashArray).toEqual([4, 4]);
    expect((daily.lineData as unknown[]).length).toBe(30);

    const byDrug = chartProps[1];
    expect(byDrug.horizontal).toBe(true);
    expect((byDrug.data as unknown[]).length).toBe(1);
  });

  it("无按药品数据：明示空态而不是留白", async () => {
    mockedFetch.mockResolvedValue({ ...makeData(7), byDrug: [] });
    const view = await renderWithQuery(<AdherenceCharts />);
    await waitFor(() => expect(view.getByText(/按药品的统计/)).toBeTruthy());
    expect(chartProps).toHaveLength(1);
  });

  it("失败：错误信息可见，重试按钮再发请求", async () => {
    mockedFetch.mockRejectedValueOnce(new Error("网络断了"));
    mockedFetch.mockResolvedValueOnce(makeData(7));
    const view = await renderWithQuery(<AdherenceCharts />);

    await waitFor(() => expect(view.getByText("打卡数据加载失败")).toBeTruthy());
    expect(view.getByText("网络断了")).toBeTruthy();
    await fireEvent.press(view.getByText("重试"));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.getByText(/执行率/)).toBeTruthy());
  });

  it("切到近 7 天：按 7 重新取数", async () => {
    mockedFetch.mockResolvedValue(makeData(30));
    const view = await renderWithQuery(<AdherenceCharts />);
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(30));

    mockedFetch.mockResolvedValue(makeData(7));
    await fireEvent.press(view.getByText("近 7 天"));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(7));
  });
});
