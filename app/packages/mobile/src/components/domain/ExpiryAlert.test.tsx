import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import { addDaysStr } from "@anxin/shared";
import { ExpiryAlert, ExpiryBanner, type ExpiryDrug } from "./ExpiryAlert";

/** 网络 / 主题侧依赖替身：与 RiskCards.test.tsx 同款（原生 wind 变量在 jest 无容器）。 */
jest.mock("nativewind", () => ({
  useUnstableNativeVariable: () => "#336699",
  cssInterop: (component: unknown) => component,
  remapProps: (component: unknown) => component,
}));

/** 横幅的跳转：babel-plugin-jest-hoist 允许 mock 前缀变量在 module factory 里被引用。 */
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

/** 固定「今天」，跨日边界可复现：第 30 天 = 临期，第 31 天 = 正常。 */
const TODAY = "2026-11-19";

function drug(id: string, genericName: string, expiry: string | null): ExpiryDrug {
  return { id, genericName, expiry };
}

/** 2 种已过期 + 3 种临期（含今天到期与第 30 天边界）+ 正常 / 未录入各 1 种（不应计数）。 */
const MIXED: ExpiryDrug[] = [
  drug("d1", "过过期药甲", "2026-10-01"), // -49 天
  drug("d2", "过过期药乙", "2026-11-01"), // -18 天
  drug("d3", "临期药丙", "2026-11-19"), // 0 天：今天到期
  drug("d4", "临期药丁", "2026-11-25"), // +6 天
  drug("d5", "临期药戊", "2026-12-19"), // +30 天：边界，仍算临期
  drug("d6", "正常药己", "2026-12-20"), // +31 天：不算
  drug("d7", "未录入药庚", null),
];

describe("ExpiryAlert · 药箱顶部汇总卡", () => {
  it("混合场景：计数、明细齐全，第 30 天算临期、第 31 天与未录入不计（安全提示已按用户要求移除）", async () => {
    const view = await render(<ExpiryAlert drugs={MIXED} today={TODAY} />);

    expect(view.getByText("效期提醒")).toBeTruthy();
    // 30 来自 shared.EXPIRY_WARNING_DAYS，渲染层不写死
    expect(view.getByText("已过期 2 种")).toBeTruthy();
    expect(view.getByText("30 天内到期 3 种")).toBeTruthy();
    // 明细：药名一行、到期日/状态一行
    expect(view.getByText("过过期药甲")).toBeTruthy();
    expect(view.getByText("2026-10-01 到期 · 已过期 49 天")).toBeTruthy();
    expect(view.getByText("临期药丙")).toBeTruthy();
    expect(view.getByText("2026-11-19 到期 · 今天到期")).toBeTruthy();
    expect(view.getByText("临期药戊")).toBeTruthy();
    expect(view.getByText("2026-12-19 到期 · 剩 30 天")).toBeTruthy();
    // 正常（+31 天）与未录入（null）都不进提醒
    expect(view.queryByText(/正常药己/)).toBeNull();
    expect(view.queryByText(/未录入药庚/)).toBeNull();
    // 过期安全提示段已删除（用户 2026-11-19 要求）
    expect(view.queryByText(/过期药请勿继续服用/)).toBeNull();
  });

  it("全正常 / 空药箱 → 不渲染（null），未录入也不当作「正常」来提醒", async () => {
    const normal = await render(
      <ExpiryAlert drugs={[drug("n1", "正常药", "2026-12-20"), drug("n2", "未录入", null)]} today={TODAY} />,
    );
    expect(normal.toJSON()).toBeNull();
    expect(normal.queryByText("效期提醒")).toBeNull();

    const empty = await render(<ExpiryAlert drugs={[]} today={TODAY} />);
    expect(empty.toJSON()).toBeNull();
  });

  it("today 注入边界：第 30 天是临期，第 31 天不算", async () => {
    const day30 = await render(
      <ExpiryAlert drugs={[drug("b1", "边界药", addDaysStr(TODAY, 30))]} today={TODAY} />,
    );
    expect(day30.getByText("30 天内到期 1 种")).toBeTruthy();
    expect(day30.getByText(/到期 · 剩 30 天/)).toBeTruthy();

    const day31 = await render(
      <ExpiryAlert drugs={[drug("b1", "边界药", addDaysStr(TODAY, 31))]} today={TODAY} />,
    );
    expect(day31.toJSON()).toBeNull();
  });

  it("明细最多 6 条，其余收成「等 N 种」", async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      drug(`m${i}`, `临期药${i + 1}`, addDaysStr(TODAY, i)),
    );
    const view = await render(<ExpiryAlert drugs={many} today={TODAY} />);

    expect(view.getAllByText(/到期 · /)).toHaveLength(6);
    expect(view.getByText(/等 2 种/)).toBeTruthy();
  });
});

describe("ExpiryBanner · 今日页横幅", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("过期 + 临期都有 → 标题 + 分段计数，点击跳药箱", async () => {
    const view = await render(<ExpiryBanner drugs={MIXED} today={TODAY} />);

    const banner = view.getByLabelText("效期提醒：已过期 2 种，30 天内到期 3 种。去药箱");
    expect(banner).toBeTruthy();
    expect(view.getByText("效期提醒")).toBeTruthy();
    expect(view.getByText("去药箱")).toBeTruthy();

    fireEvent.press(banner);
    expect(mockPush).toHaveBeenCalledWith("/box");
  });

  it("只有临期 → 只显示临期计数；无提醒 → 不渲染", async () => {
    const onlyExpiring = await render(
      <ExpiryBanner drugs={[drug("e1", "临期药", "2026-11-25")]} today={TODAY} />,
    );
    expect(onlyExpiring.getByText("30 天内到期 1 种")).toBeTruthy();
    expect(onlyExpiring.queryByText(/已过期/)).toBeNull();

    const none = await render(
      <ExpiryBanner drugs={[drug("n1", "正常药", "2026-12-20")]} today={TODAY} />,
    );
    expect(none.toJSON()).toBeNull();
  });
});
