import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text as RNText } from "react-native";
import { ApiRequestError, bootstrapAuth, signIn, useAuthStore } from "@anxin/core";
import { AuthGate } from "./AuthGate";

// 只替身两个网络动作（启动恢复 / 登录），store 与 ApiRequestError 走真代码——同 web Login.test.tsx 的做法。
jest.mock("@anxin/core", () => {
  const actual = jest.requireActual<typeof import("@anxin/core")>("@anxin/core");
  return { ...actual, bootstrapAuth: jest.fn(async () => {}), signIn: jest.fn() };
});

// nativewind 的令牌读取在 jest 里没有 CSS 运行时，给固定色（同 RiskCards.test.tsx）。
jest.mock("nativewind", () => ({
  useUnstableNativeVariable: () => "#336699",
  cssInterop: (component: unknown) => component,
  remapProps: (component: unknown) => component,
}));

// keyboard-controller 的容器是原生视图；登录页只用它做键盘避让，测试换成普通 View。
jest.mock("react-native-keyboard-controller", () => ({
  KeyboardAvoidingView: jest.requireActual<{ View: unknown }>("react-native").View,
}));

const mockBootstrap = jest.mocked(bootstrapAuth);
const mockSignIn = jest.mocked(signIn);

function renderGate() {
  return render(
    <AuthGate>
      <RNText>受保护内容</RNText>
    </AuthGate>,
  );
}

beforeEach(() => {
  mockBootstrap.mockClear();
  mockBootstrap.mockResolvedValue(undefined);
  mockSignIn.mockReset();
  useAuthStore.setState({ status: "idle", mode: null, user: null, error: null });
});

afterEach(() => {
  useAuthStore.setState({ status: "idle", mode: null, user: null, error: null });
});

describe("AuthGate · 登录门", () => {
  it("loading 显示检查中，不渲染受保护内容；挂载即触发一次启动恢复", async () => {
    useAuthStore.setState({ status: "loading", mode: null, user: null, error: null });
    const view = await renderGate();

    expect(view.getByText("正在检查登录状态…")).toBeTruthy();
    expect(view.queryByText("受保护内容")).toBeNull();
    await waitFor(() => expect(mockBootstrap).toHaveBeenCalledTimes(1));
  });

  it("error 显示失败原因与重试，点重试再次调用 bootstrapAuth（不静默当未登录）", async () => {
    useAuthStore.setState({ status: "error", mode: null, user: null, error: "网络连接失败" });
    const view = await renderGate();

    expect(view.getByText("暂时无法确认登录状态")).toBeTruthy();
    expect(view.getByText("网络连接失败")).toBeTruthy();
    await fireEvent.press(view.getByRole("button"));
    await waitFor(() => expect(mockBootstrap).toHaveBeenCalledTimes(2));
  });

  it("anonymous 渲染登录界面与底部说明，不渲染受保护内容", async () => {
    useAuthStore.setState({ status: "anonymous", mode: null, user: null, error: null });
    const view = await renderGate();

    expect(view.getByText("登录安心用药")).toBeTruthy();
    expect(view.getByText("账号由管理员分配；忘记密码请联系管理员重置。")).toBeTruthy();
    expect(view.queryByText("受保护内容")).toBeNull();
  });

  it("登录失败内联展示可读文案，请求参数已 trim，按钮恢复可点", async () => {
    useAuthStore.setState({ status: "anonymous", mode: null, user: null, error: null });
    mockSignIn.mockRejectedValue(new ApiRequestError("账号或密码错误", "AUTH_INVALID", 401));
    const view = await renderGate();

    await fireEvent.changeText(view.getByLabelText("账号"), "  demo-user  ");
    await fireEvent.changeText(view.getByLabelText("密码"), "wrong-password");
    await fireEvent.press(view.getByRole("button"));

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith("demo-user", "wrong-password"),
    );
    expect(await view.findByText("账号或密码错误")).toBeTruthy();
    // pending 结束后按钮文案回到「登录」，即防重复提交的禁用态已解除。
    expect(view.getByText("登录")).toBeTruthy();
  });

  it("authenticated 直接放行 children", async () => {
    useAuthStore.setState({
      status: "authenticated",
      mode: "password",
      user: { id: "u1", name: "测试用户", username: "demo-user" },
      error: null,
    });
    const view = await renderGate();

    expect(view.getByText("受保护内容")).toBeTruthy();
  });
});
