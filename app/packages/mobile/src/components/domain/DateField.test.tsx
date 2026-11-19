import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import { DateField, composeDate, pad2 } from "./DateField";

/**
 * composeDate / pad2 是从 SigCard 抽到 components/domain/DateField.tsx 的纯函数。
 * 这里锁住抽离前的契约：三段都合法才拼规范 ISO 日期，不完整 / 不存在的日期返回空串。
 */
describe("composeDate · 年 / 月 / 日三框拼接", () => {
  it("三段齐全且为真实日历日 → 补零拼成 YYYY-MM-DD", () => {
    expect(composeDate("2026", "10", "21")).toBe("2026-10-21");
    expect(composeDate("2027", "3", "1")).toBe("2027-03-01");
    expect(composeDate("2024", "02", "29")).toBe("2024-02-29");
  });

  it("不完整 / 不存在的日期 → 空串（上层按未录入或闸门拦截处理）", () => {
    expect(composeDate("", "10", "21")).toBe("");
    expect(composeDate("202", "10", "21")).toBe("");
    expect(composeDate("2026", "", "21")).toBe("");
    expect(composeDate("2026", "10", "")).toBe("");
    expect(composeDate("2026", "13", "01")).toBe("");
    expect(composeDate("2026", "00", "10")).toBe("");
    expect(composeDate("2026", "02", "31")).toBe("");
    expect(composeDate("2025", "02", "29")).toBe("");
    expect(composeDate("2026", "10", "00")).toBe("");
  });

  it("pad2 始终两位（年份不做 pad2，保持四段原文校验）", () => {
    expect(pad2(2)).toBe("02");
    expect(pad2(12)).toBe("12");
  });
});

describe("DateField · RN 三框编辑（抽离后行为不变）", () => {
  it("按年 / 月 / 日逐框输入，三段齐全后回传规范 YYYY-MM-DD", async () => {
    const onChange = jest.fn<(next: string) => void>();
    const view = await render(
      <DateField value="" onChange={onChange} labelPrefix="有效期" optional />,
    );

    await fireEvent.changeText(view.getByLabelText("有效期 年"), "2027");
    await fireEvent.changeText(view.getByLabelText("有效期 月"), "3");
    await fireEvent.changeText(view.getByLabelText("有效期 日"), "1");

    expect(onChange).toHaveBeenLastCalledWith("2027-03-01");
  });

  it("半截输入回传空串，可选项只在填了一半时提示「填完整才生效」", async () => {
    const view = await render(
      <DateField value="" onChange={() => {}} labelPrefix="有效期" optional />,
    );
    // 全空（未录入）不打扰
    expect(view.queryByText(/日期还没填完整/)).toBeNull();

    await fireEvent.changeText(view.getByLabelText("有效期 年"), "2027");
    expect(view.getByText(/日期还没填完整/)).toBeTruthy();
    expect(view.queryByText(/请填写完整的年/)).toBeNull();
  });

  it("必填语义（SigCard 开始日期）保留抽离前的「否则无法确认」文案", async () => {
    const view = await render(
      <DateField value="2027-03-01" onChange={() => {}} labelPrefix="开始日期" />,
    );
    expect(view.queryByText(/请填写完整的年/)).toBeNull();

    await fireEvent.changeText(view.getByLabelText("开始日期 日"), "");
    expect(view.getByText(/请填写完整的年/)).toBeTruthy();
  });

  it("外部把值清空时回填为空（弹窗重开 / 表单重置不残留旧日期）", async () => {
    const view = await render(
      <DateField value="2027-03-01" onChange={() => {}} labelPrefix="开封日期" optional />,
    );
    expect(view.getByDisplayValue("2027")).toBeTruthy();

    await view.rerender(
      <DateField value="" onChange={() => {}} labelPrefix="开封日期" optional />,
    );
    expect(view.queryByDisplayValue("2027")).toBeNull();
  });
});
