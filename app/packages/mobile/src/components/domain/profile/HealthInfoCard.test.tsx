/**
 * 健康信息卡 · 年龄与出生年月联动（2026-11-19，对齐 web `HealthInfo.test.tsx` 的联动断言）。
 *
 * 弹窗模块走手动替身 `src/components/ui/__mocks__/dialog.tsx`（View/Text 直出）：
 * 本用例验证的是「联动状态机 + PATCH 入参」，真机弹窗外观由 T5-真机验收覆盖；
 * 替身可避开 reanimated / keyboard-controller / screens 等原生依赖在 jest 环境的初始化。
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ageFromBirthMonth } from "@anxin/shared";

jest.mock("nativewind", () => ({
  useUnstableNativeVariable: () => "#336699",
  cssInterop: (component: unknown) => component,
  remapProps: (component: unknown) => component,
}));

const mockFetchProfile = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockPatchProfile = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("@anxin/core", () => ({
  fetchProfile: (...args: unknown[]) => mockFetchProfile(...args),
  client: {
    api: {
      profile: {
        $patch: (...args: unknown[]) => mockPatchProfile(...args),
      },
    },
  },
  unwrap: async (res: unknown) => res,
}));

jest.mock("@/components/ui/dialog");

import { HealthInfoCard } from "./HealthInfoCard";

async function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <HealthInfoCard />
    </QueryClientProvider>,
  );
}

/** 出生年月 1958-06 + 一条故意不一致的旧手填年龄：联动后应以出生年月算出的为准。 */
const BIRTH_ITEMS = [
  {
    id: "h1",
    fieldKey: "出生年月",
    value: "1958-06",
    sourceMeta: { source: "self_reported", confirmedAt: "2026-11-01T00:00:00.000Z" },
  },
  {
    id: "h2",
    fieldKey: "年龄",
    value: "70",
    sourceMeta: { source: "self_reported", confirmedAt: "2026-11-01T00:00:00.000Z" },
  },
];

beforeEach(() => {
  mockFetchProfile.mockReset();
  mockFetchProfile.mockResolvedValue({ items: BIRTH_ITEMS });
  mockPatchProfile.mockReset();
  mockPatchProfile.mockResolvedValue({ ok: true, items: [] });
});
afterEach(cleanup);

describe("健康信息卡 · 年龄与出生年月联动", () => {
  it("有出生年月：年龄行只读展示自动计算值，旧手填值不再显示", async () => {
    const view = await renderCard();
    const age = ageFromBirthMonth("1958-06");
    expect(age).not.toBeNull();
    expect(await view.findByText("按出生年月自动计算")).toBeTruthy();
    expect(view.getByText(String(age))).toBeTruthy();
    expect(view.queryByText("70")).toBeNull();
  });

  it("点年龄行：说明由出生年月算出，可直达出生年月编辑", async () => {
    const view = await renderCard();
    await view.findByText("按出生年月自动计算");
    const age = ageFromBirthMonth("1958-06");
    await fireEvent.press(view.getByRole("button", { name: /年龄/ }));
    expect(await view.findByText(new RegExp(`自动算出 ${age} 岁`))).toBeTruthy();
    await fireEvent.press(view.getByText("修改出生年月"));
    expect(await view.findByText("编辑「出生年月」")).toBeTruthy();
  });

  it("未填出生年月：年龄仍可手填（只知年龄的老人有退路）", async () => {
    mockFetchProfile.mockResolvedValue({ items: [] });
    const view = await renderCard();
    await view.findAllByText("待补充");
    await fireEvent.press(view.getByRole("button", { name: /年龄/ }));
    await fireEvent.changeText(await view.findByLabelText("年龄（内容）"), "72");
    await fireEvent.press(view.getByText("保存"));
    await waitFor(() =>
      expect(mockPatchProfile).toHaveBeenCalledWith({
        json: { upserts: [{ fieldKey: "年龄", value: "72" }] },
      }),
    );
  });

  it("保存出生年月：同一次 PATCH 写入出生年月 + 联动算出的年龄", async () => {
    mockFetchProfile.mockResolvedValue({ items: [] });
    const view = await renderCard();
    await view.findAllByText("待补充");
    await fireEvent.press(view.getByRole("button", { name: /出生年月/ }));
    await fireEvent.changeText(await view.findByLabelText("出生年份"), "1958");
    await fireEvent.changeText(view.getByLabelText("出生月份"), "6");
    await fireEvent.press(view.getByText("保存"));

    const age = ageFromBirthMonth("1958-06");
    expect(age).not.toBeNull();
    await waitFor(() =>
      expect(mockPatchProfile).toHaveBeenCalledWith({
        json: {
          upserts: [
            { fieldKey: "出生年月", value: "1958-06" },
            { fieldKey: "年龄", value: String(age) },
          ],
        },
      }),
    );
  });

  it("未来出生年月：提示且保存被挡（算不出年龄，也不该写库）", async () => {
    mockFetchProfile.mockResolvedValue({ items: [] });
    const view = await renderCard();
    await view.findAllByText("待补充");
    await fireEvent.press(view.getByRole("button", { name: /出生年月/ }));
    await fireEvent.changeText(await view.findByLabelText("出生年份"), "2999");
    await fireEvent.changeText(view.getByLabelText("出生月份"), "1");
    expect(await view.findByText(/不能晚于当前月份/)).toBeTruthy();
    await fireEvent.press(view.getByText("保存"));
    expect(mockPatchProfile).not.toHaveBeenCalled();
  });
});
