import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import type { DraftPayload } from "@anxin/core";
import { ConfirmResultDialog, InteractionCard, type ConfirmResult } from "./RiskCards";

jest.mock("nativewind", () => ({
  useUnstableNativeVariable: () => "#336699",
  cssInterop: (component: unknown) => component,
  remapProps: (component: unknown) => component,
}));

// Dialog 链会拉起 reanimated/worklets 原生初始化；本测试只渲染 InteractionCard（不触发 Dialog），
// 用 host 组件名直接替身，避免在 jest 环境启动原生 worklets。ConfirmResultDialog 用例需要标题/说明
// 能承载原始字符串，故映射为 "Text"。
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

type Interaction = NonNullable<DraftPayload["interactions"]>;
type Hit = Interaction["hits"][number];

function resultWith(status: Hit["status"]): Interaction {
  const hit: Hit = {
    level: "需监测",
    note: "演示说明：两药联用需关注。",
    source: "两药说明书相互作用段（演示抄录）",
    status,
    drugIds: ["dm-a", "dm-b"],
    drugNames: ["药A", "药B"],
  };
  return { hits: [hit], coverageNote: null };
}

describe("InteractionCard · M8 规则状态标识", () => {
  it("status=demo 的命中显示「演示抄录 · 非正式规则库」", async () => {
    const view = await render(<InteractionCard result={resultWith("demo")} />);
    expect(view.getByText(/演示抄录 · 非正式规则库/)).toBeTruthy();
    expect(view.getByText(/药A、药B/)).toBeTruthy();
  });

  it("status=curated 的命中不显示演示徽章", async () => {
    const view = await render(<InteractionCard result={resultWith("curated")} />);
    expect(view.queryByText(/演示抄录 · 非正式规则库/)).toBeNull();
  });

  it("无命中时显示未覆盖提示（未覆盖 ≠ 无风险）", async () => {
    const view = await render(
      <InteractionCard
        result={{ hits: [], coverageNote: "当前药品组合未被相互作用规则库覆盖 ≠ 无风险，联用前请咨询医生或药师" }}
      />,
    );
    expect(view.getByText(/未被相互作用规则库覆盖/)).toBeTruthy();
  });
});

describe("ConfirmResultDialog · 入箱预检口径（V2.5）", () => {
  const precheckResult = {
    ok: true,
    drugId: "drug-new",
    planId: null,
    sourceId: "src-1",
    status: "confirmed",
    interactions: null,
    dosageRange: null,
    precheck: {
      status: "checked",
      interactions: { hits: [resultWith("curated").hits[0]], coverageNote: null },
      activePlanCount: 1,
      skippedDrugNames: [],
      ruleLibrary: { total: 1, demo: 0, curated: 1 },
    },
  } as unknown as ConfirmResult;

  it("mode='precheck' 用「当前生效计划集合」口径描述，并展示命中", async () => {
    const view = await render(
      <ConfirmResultDialog
        result={precheckResult}
        drugName="药B"
        mode="precheck"
        onDone={() => {}}
      />,
    );
    expect(view.getByText(/已按你当前生效的计划集合检查相互作用/)).toBeTruthy();
    expect(view.getByText(/相互作用（1 条）/)).toBeTruthy();
    expect(view.getByText(/药A、药B/)).toBeTruthy();
  });
});
