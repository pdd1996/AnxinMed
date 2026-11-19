import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import type { SafetySummaryDto } from "@anxin/core";
import { SafetyAlertCard, worstInteractionLevelForDrug } from "./SafetyAlertCard";
import { RuleCheckAlertDialog } from "@/components/domain/draft/RiskCards";

jest.mock("nativewind", () => ({
  useUnstableNativeVariable: () => "#336699",
  cssInterop: (component: unknown) => component,
  remapProps: (component: unknown) => component,
}));

// Dialog 链会拉起 reanimated/worklets 原生初始化；用 host 组件名替身，避免在 jest 环境启动原生 worklets。
// 标题/说明映射为 "Text"（原始字符串必须落在 Text 里），其余映射为 "View"。
jest.mock("@/components/ui/dialog", () =>
  new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === "__esModule") return true;
        const key = String(name);
        return key === "DialogTitle" || key === "DialogDescription" ? "Text" : "View";
      },
    },
  ),
);

type Hit = SafetySummaryDto["interactions"]["hits"][number];

function hit(overrides: Partial<Hit> = {}): Hit {
  return {
    level: "需监测",
    note: "两种滴眼液同时使用需间隔至少 30 分钟",
    source: "两药说明书相互作用段（演示抄录）",
    status: "demo",
    drugIds: ["dm-a", "dm-b"],
    drugNames: ["药A", "药B"],
    ...overrides,
  };
}

function summaryWith(hits: Hit[]): SafetySummaryDto {
  return {
    interactions: { hits, coverageNote: null },
    activePlanCount: 2,
    checkedDrugNames: ["药A", "药B"],
    skippedDrugNames: [],
    ruleLibrary: { total: 52, demo: 2, curated: 50 },
    checkedAt: new Date().toISOString(),
  };
}

describe("SafetyAlertCard · 常驻用药安全提示（V2.5 主动干预）", () => {
  it("有命中时展示最重级别、条数、规则库覆盖说明与演示标识", async () => {
    const view = await render(
      <SafetyAlertCard summary={summaryWith([hit(), hit({ level: "禁忌", note: "禁忌说明" })])} />,
    );
    expect(view.getAllByText(/用药安全提示/).length).toBeGreaterThan(0);
    expect(view.getByText(/检出 2 项相互作用提示/)).toBeTruthy();
    expect(view.getByText(/最高「禁忌」/)).toBeTruthy();
    expect(view.getByText(/规则库 52 条（演示抄录 2 条）/)).toBeTruthy();
    expect(view.getAllByText(/演示抄录 · 非正式规则库/).length).toBeGreaterThan(0);
  });

  it("无命中时整卡不渲染（不制造噪声）", async () => {
    const view = await render(<SafetyAlertCard summary={summaryWith([])} />);
    expect(view.toJSON()).toBeNull();
  });

  it("数据未就绪（loading/失败）时不渲染，不阻塞主流程", async () => {
    const view = await render(<SafetyAlertCard summary={undefined} />);
    expect(view.toJSON()).toBeNull();
  });
});

describe("worstInteractionLevelForDrug · 药卡角标", () => {
  it("返回该药涉及的最重级别；没有 drug_master.id 或未命中 → null", () => {
    const summary = summaryWith([
      hit({ level: "注意", drugIds: ["dm-a"] }),
      hit({ level: "禁忌", drugIds: ["dm-a", "dm-c"] }),
    ]);
    expect(worstInteractionLevelForDrug(summary, "dm-a")).toBe("禁忌");
    expect(worstInteractionLevelForDrug(summary, "dm-x")).toBeNull();
    expect(worstInteractionLevelForDrug(summary, null)).toBeNull();
    expect(worstInteractionLevelForDrug(undefined, "dm-a")).toBeNull();
  });
});

describe("RuleCheckAlertDialog · 建计划/恢复后结果回显", () => {
  it("有命中时展示分级、说明与来源（服务端结果不再被静默丢弃）", async () => {
    const view = await render(
      <RuleCheckAlertDialog
        open
        title="计划已创建"
        result={{ hits: [hit()], coverageNote: null }}
        onClose={() => {}}
      />,
    );
    expect(view.getByText(/计划已创建/)).toBeTruthy();
    expect(view.getByText(/相互作用（1 条）/)).toBeTruthy();
    expect(view.getByText(/两种滴眼液同时使用/)).toBeTruthy();
    expect(view.getByText(/来源：两药说明书相互作用段/)).toBeTruthy();
  });

  it("无命中且无范围问题时不渲染弹窗", async () => {
    const view = await render(
      <RuleCheckAlertDialog
        open
        title="计划已创建"
        result={{ hits: [], coverageNote: null }}
        onClose={() => {}}
      />,
    );
    expect(view.toJSON()).toBeNull();
  });
});
