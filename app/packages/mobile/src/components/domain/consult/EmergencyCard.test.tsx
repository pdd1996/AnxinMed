import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import type { ConsultSections } from "@anxin/shared";
import { EmergencyCard } from "./EmergencyCard";

jest.mock("@anxin/core", () => ({
  isSpeechSupported: () => false,
  speak: () => {},
  stopSpeaking: () => {},
}));

const sections: ConsultSections = {
  summary: "你的症状可能是紧急情况，请立即就医。",
  keyPoints: [],
  risks: ["胸痛持续不缓解", "呼吸困难"],
  nextAction: "立即拨打 120 或前往最近急诊。",
  warning: "不要自行用药或等待观察。",
};

describe("EmergencyCard · L4", () => {
  it("渲染紧急标题、风险、120 大按钮与急诊入口", async () => {
    const view = await render(<EmergencyCard sections={sections} />);

    expect(view.getByText("紧急风险提示")).toBeTruthy();
    expect(view.getByText("胸痛持续不缓解")).toBeTruthy();
    expect(view.getByText("呼吸困难")).toBeTruthy();
    expect(view.getByText("立即拨打 120")).toBeTruthy();
    expect(view.getByText("查找附近急诊")).toBeTruthy();
    expect(view.getByText("立即拨打 120 或前往最近急诊。")).toBeTruthy();
  });
});
