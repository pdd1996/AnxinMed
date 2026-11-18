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

describe("AnswerCard · 状态分支", () => {
  it("L1 answered 渲染五段", async () => {
    const view = await render(
      <AnswerCard
        riskLevel="L1"
        status="answered"
        answer="回答"
        sections={sections}
        citations={[]}
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
  });

  it("L2 limited 显示 notice（状态徽章已移除）", async () => {
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

    expect(view.queryByText("已过滤剂量")).toBeNull();
    expect(view.getByText("已过滤具体剂量建议。")).toBeTruthy();
  });

  it("L3 refused 渲染拒答文案与 blocked 边框", async () => {
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

    expect(view.queryByText("已拒答")).toBeNull();
    expect(view.getByText("我不能建议你自行增减剂量、停药或换药。")).toBeTruthy();
  });

  it("manual-gate 渲染 l0Notice（状态徽章已移除）", async () => {
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

    expect(view.queryByText("仅资料查询")).toBeNull();
    expect(view.getByText("仅可查询药品资料。")).toBeTruthy();
  });

  it("data-answered 渲染纯文本回答（数据查询/来源徽章已移除）", async () => {
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

    expect(view.queryByText("数据查询")).toBeNull();
    expect(view.queryByText("来源：药箱清单")).toBeNull();
    expect(view.getByText("你的药箱有 5 种药。")).toBeTruthy();
  });

  it("clarify 渲染药名选项，点选回传 drugId（M13-P1）", async () => {
    const picked: string[] = [];
    const view = await render(
      <AnswerCard
        riskLevel="L1"
        status="clarify"
        answer="你想问药箱里的哪种药？"
        sections={{
          summary: "你想问药箱里的哪种药？",
          keyPoints: ["点选下面的药名，我会按该药的说明书回答。"],
          risks: [],
          nextAction: "点选一种药继续提问。",
          warning: "我只基于本地说明书库解释已确认药品的资料。",
        }}
        citations={[]}
        clarifyOptions={[{ drugId: "drug-1", drugName: "玻璃酸钠滴眼液（海露）" }]}
        onPickDrug={(drugId) => picked.push(drugId)}
      />,
    );

    expect(view.getByText("选择一种药继续：")).toBeTruthy();
    fireEvent.press(view.getByText("玻璃酸钠滴眼液（海露）"));
    expect(picked).toEqual(["drug-1"]);
  });
});
