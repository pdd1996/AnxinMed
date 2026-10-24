import { describe, expect, it } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import type { ConsultSections } from "@anxin/shared";
import { AnswerCard } from "./AnswerCard";

const sections: ConsultSections = {
  summary: "总结内容",
  keyPoints: ["要点一", "要点二"],
  risks: ["风险一"],
  nextAction: "下一步动作",
  warning: "警示语",
};

const citations = [
  {
    drugName: "玻璃酸钠滴眼液",
    source: "说明书",
    version: "2025-01",
    sectionKey: "indication",
  },
];

describe("AnswerCard · 状态分支", () => {
  it("L1 answered 渲染五段与 citations 折叠", async () => {
    const view = await render(
      <AnswerCard
        riskLevel="L1"
        status="answered"
        answer="回答"
        sections={sections}
        citations={citations}
      />,
    );

    expect(view.getByText("简明结论")).toBeTruthy();
    expect(view.getByText("总结内容")).toBeTruthy();
    expect(view.getByText("需要知道")).toBeTruthy();
    expect(view.getByText("要点一")).toBeTruthy();
    expect(view.getByText("注意风险")).toBeTruthy();
    expect(view.getByText("风险一")).toBeTruthy();
    expect(view.getByText("下一步")).toBeTruthy();
    expect(view.getByText("警示语")).toBeTruthy();

    expect(view.queryByText("玻璃酸钠滴眼液")).toBeNull();
    await fireEvent.press(view.getByRole("button"));
    expect(view.getByText("玻璃酸钠滴眼液")).toBeTruthy();
    expect(view.getByText(/版本：2025-01/)).toBeTruthy();
  });

  it("L2 limited 显示已过滤剂量与 notice", async () => {
    const view = await render(
      <AnswerCard
        riskLevel="L2"
        status="limited"
        answer="回答"
        sections={null}
        citations={[]}
        notice="已过滤具体剂量建议。"
      />,
    );

    expect(view.getByText("已过滤剂量")).toBeTruthy();
    expect(view.getByText("已过滤具体剂量建议。")).toBeTruthy();
  });

  it("L3 refused 显示已拒答与 blocked 文案", async () => {
    const view = await render(
      <AnswerCard
        riskLevel="L3"
        status="refused"
        answer="我不能建议你自行增减剂量、停药或换药。"
        sections={null}
        citations={[]}
        blocked
      />,
    );

    expect(view.getByText("已拒答")).toBeTruthy();
    expect(view.getByText("我不能建议你自行增减剂量、停药或换药。")).toBeTruthy();
  });

  it("manual-gate 显示仅资料查询与 l0Notice", async () => {
    const view = await render(
      <AnswerCard
        riskLevel="L1"
        status="manual-gate"
        answer="回答"
        sections={null}
        citations={[]}
        l0Notice="仅可查询药品资料。"
      />,
    );

    expect(view.getByText("仅资料查询")).toBeTruthy();
    expect(view.getByText("仅可查询药品资料。")).toBeTruthy();
  });

  it("data-answered 显示数据查询徽章与来源工具", async () => {
    const view = await render(
      <AnswerCard
        riskLevel="L1"
        status="data-answered"
        answer="你的药箱有 5 种药。"
        sections={null}
        citations={[]}
        toolUsed="medication-list"
      />,
    );

    expect(view.getByText("数据查询")).toBeTruthy();
    expect(view.getByText("来源：药箱清单")).toBeTruthy();
  });
});
