import { describe, expect, it, jest } from "@jest/globals";
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

  it("manual-gate 不渲染 l0Notice banner（2026-11-20 用户裁定删除）", async () => {
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
    expect(view.queryByText("仅可查询药品资料。")).toBeNull();
    expect(view.getByText("回答")).toBeTruthy();
  });

  // 2026-11-20 排版优化 + 用户裁定删除顶部 banner：L0 卡只保留原文语义标签/展开/查看入口
  it("L0（manual-gate）→ 无顶部 banner，原文版式 + 展开原文 + 查看入口", async () => {
    const onViewLeaflet = jest.fn();
    const view = await render(
      <AnswerCard
        riskLevel="L1"
        status="manual-gate"
        answer="用于缓解干眼症状"
        sections={{
          summary: "用于缓解干眼症状",
          keyPoints: ["开封后一个月内使用"],
          risks: ["对玻璃酸钠过敏者禁用"],
          nextAction: "如有疑问，请咨询医生或药师。",
          warning: "不要根据 AI 回答自行调整处方。",
          details: [
            { title: "适应症段（原文）", body: "适应症原文全文", source: "丁香园用药助手" },
          ],
        }}
        citations={[
          {
            drugName: "玻璃酸钠滴眼液",
            source: "丁香园用药助手",
            version: "2024-01",
            unverified: false,
            reviewStatus: "crawled",
            specification: "0.1%（10mL:10mg）",
            approvalNumbers: ["国药准字H20240001"],
          },
        ]}
        l0Notice="该药说明书尚未人工核验，暂不能提供个性化解释，仅可查看说明书原文。"
        onViewLeaflet={onViewLeaflet}
        blocked
      />,
    );

    // 顶部 banner 已删除（未核验/身份/来源只在分段落页展示）
    expect(view.queryByText(/暂不能提供个性化解释/)).toBeNull();
    expect(view.queryByText(/核验状态：/)).toBeNull();
    expect(view.queryByText(/批准文号：/)).toBeNull();
    // 原文语义标题
    expect(view.getByText("说明书原文")).toBeTruthy();
    expect(view.getByText("注意事项")).toBeTruthy();
    expect(view.getByText("禁忌")).toBeTruthy();
    expect(view.queryByText("简明结论")).toBeNull();
    // 完整原文默认收起，点开可看
    expect(view.getByText("展开原文（1 条）")).toBeTruthy();
    expect(view.queryByText("适应症段（原文）")).toBeNull();
    await fireEvent.press(view.getByText("展开原文（1 条）"));
    expect(view.getByText("适应症段（原文）")).toBeTruthy();
    expect(view.getByText("适应症原文全文")).toBeTruthy();
    // 查看入口
    await fireEvent.press(view.getByText("查看完整说明书"));
    expect(onViewLeaflet).toHaveBeenCalledTimes(1);
  });

  it("L0 带查看入口 → 点「查看完整说明书」回调（2026-11-20）", async () => {
    const onViewLeaflet = jest.fn();
    const view = await render(
      <AnswerCard
        riskLevel="L1"
        status="manual-gate"
        answer="用于缓解干眼症状"
        sections={{
          summary: "用于缓解干眼症状",
          keyPoints: [],
          risks: [],
          nextAction: "如有疑问，请咨询医生或药师。",
          warning: "不要根据 AI 回答自行调整处方。",
        }}
        citations={[]}
        l0Notice="该药说明书尚未人工核验，暂不能提供个性化解释，仅可查看说明书原文。"
        onViewLeaflet={onViewLeaflet}
      />,
    );
    await fireEvent.press(view.getByText("查看完整说明书"));
    expect(onViewLeaflet).toHaveBeenCalledTimes(1);
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
