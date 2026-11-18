import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text as RNText } from "react-native";
import {
  ApiRequestError,
  bootstrapAuth,
  requestPhoneCode,
  signIn,
  signInWithPhone,
  useAuthStore,
} from "@anxin/core";
import { AuthGate } from "./AuthGate";

// 只替身网络动作（启动恢复 / 密码登录 / 手机号发码与登录），store 与 ApiRequestError 走真代码——
// 同 web Login.test.tsx 的做法。
jest.mock("@anxin/core", () => {
  const actual = jest.requireActual<typeof import("@anxin/core")>("@anxin/core");
  return {
    ...actual,
    bootstrapAuth: jest.fn(async () => {}),
    signIn: jest.fn(),
    requestPhoneCode: jest.fn(),
    signInWithPhone: jest.fn(),
  };
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
const mockRequestPhoneCode = jest.mocked(requestPhoneCode);
const mockSignInWithPhone = jest.mocked(signInWithPhone);

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
  mockRequestPhoneCode.mockReset();
  mockSignInWithPhone.mockReset();
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

  it("error 里混入英文技术串 → 展示中文网络文案，不把英文原样上屏", async () => {
    useAuthStore.setState({ status: "error", mode: null, user: null, error: "Failed to fetch" });
    const view = await renderGate();

    expect(view.getByText("网络连接失败，请检查网络后重试")).toBeTruthy();
    expect(view.queryByText("Failed to fetch")).toBeNull();
  });

  it("error 为空 → 展示中文默认提示，仍给重试入口", async () => {
    useAuthStore.setState({ status: "error", mode: null, user: null, error: null });
    const view = await renderGate();

    expect(view.getByText("请检查网络或服务器连接后重试。")).toBeTruthy();
    expect(view.getByRole("button")).toBeTruthy();
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
    await fireEvent.press(view.getByRole("button", { name: "登录" }));

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith("demo-user", "wrong-password"),
    );
    expect(await view.findByText("账号或密码错误")).toBeTruthy();
    // pending 结束后按钮文案回到「登录」，即防重复提交的禁用态已解除。
    expect(view.getByText("登录")).toBeTruthy();
  });

  it("断网/网络层异常 → 内联展示中文「网络连接失败」，不露英文技术串", async () => {
    useAuthStore.setState({ status: "anonymous", mode: null, user: null, error: null });
    mockSignIn.mockRejectedValue(new TypeError("Network request failed"));
    const view = await renderGate();

    await fireEvent.changeText(view.getByLabelText("账号"), "demo-user");
    await fireEvent.changeText(view.getByLabelText("密码"), "secret-123");
    await fireEvent.press(view.getByRole("button", { name: "登录" }));

    expect(await view.findByText("网络连接失败，请检查网络后重试")).toBeTruthy();
    expect(view.queryByText("Network request failed")).toBeNull();
  });

  it("英文服务异常（500）→ 内联展示中文「服务暂时不可用」", async () => {
    useAuthStore.setState({ status: "anonymous", mode: null, user: null, error: null });
    mockSignIn.mockRejectedValue(new ApiRequestError("Internal Server Error", undefined, 500));
    const view = await renderGate();

    await fireEvent.changeText(view.getByLabelText("账号"), "demo-user");
    await fireEvent.changeText(view.getByLabelText("密码"), "secret-123");
    await fireEvent.press(view.getByRole("button", { name: "登录" }));

    expect(await view.findByText("服务暂时不可用，请稍后重试")).toBeTruthy();
    expect(view.queryByText("Internal Server Error")).toBeNull();
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

describe("AuthGate · 手机号验证码登录/注册（P1）", () => {
  function renderAnonymous() {
    useAuthStore.setState({ status: "anonymous", mode: null, user: null, error: null });
    return renderGate();
  }

  it("切到手机号登录 → 显示手机号/验证码表单；空提交不发请求并提示手机号", async () => {
    const view = await renderAnonymous();
    await fireEvent.press(view.getByLabelText("手机号登录"));

    expect(view.getByLabelText("手机号")).toBeTruthy();
    expect(view.getByLabelText("短信验证码")).toBeTruthy();
    expect(view.getByText("未注册的手机号验证通过后将自动创建账号。")).toBeTruthy();

    await fireEvent.press(view.getByRole("button", { name: "登录 / 注册" }));
    expect(await view.findByText("请输入 11 位手机号")).toBeTruthy();
    expect(mockSignInWithPhone).not.toHaveBeenCalled();
  });

  it("获取验证码：手机号非法 → 提示且不请求接口", async () => {
    const view = await renderAnonymous();
    await fireEvent.press(view.getByLabelText("手机号登录"));
    await fireEvent.changeText(view.getByLabelText("手机号"), "12345");

    await fireEvent.press(view.getByRole("button", { name: "获取验证码" }));

    expect(await view.findByText("请输入 11 位手机号")).toBeTruthy();
    expect(mockRequestPhoneCode).not.toHaveBeenCalled();
  });

  it("获取验证码成功 → 展示短信落款并进入冷却（按钮禁用、显示倒计时）", async () => {
    mockRequestPhoneCode.mockResolvedValue({
      ok: true,
      mode: "password",
      cooldownSec: 60,
      expiresInSec: 300,
      signName: "恒创联众",
    });
    const view = await renderAnonymous();
    await fireEvent.press(view.getByLabelText("手机号登录"));
    await fireEvent.changeText(view.getByLabelText("手机号"), "13800138000");

    await fireEvent.press(view.getByRole("button", { name: "获取验证码" }));

    await waitFor(() => expect(mockRequestPhoneCode).toHaveBeenCalledWith("13800138000"));
    expect(
      await view.findByText("短信落款为「恒创联众」，请注意查收；验证码请勿告诉他人。"),
    ).toBeTruthy();
    const resend = view.getByText(/秒后重发/);
    expect(resend).toBeTruthy();
    // 冷却中再点不会重复请求
    await fireEvent.press(resend);
    expect(mockRequestPhoneCode).toHaveBeenCalledTimes(1);
  });

  it("获取验证码失败（频控）→ 内联展示服务端中文文案", async () => {
    mockRequestPhoneCode.mockRejectedValue(
      new ApiRequestError("验证码发送太频繁，请稍后再试", "SMS_LIMITED", 429),
    );
    const view = await renderAnonymous();
    await fireEvent.press(view.getByLabelText("手机号登录"));
    await fireEvent.changeText(view.getByLabelText("手机号"), "13800138000");

    await fireEvent.press(view.getByRole("button", { name: "获取验证码" }));

    expect(await view.findByText("验证码发送太频繁，请稍后再试")).toBeTruthy();
  });

  it("提交登录/注册：手机号与验证码交给 signInWithPhone", async () => {
    mockSignInWithPhone.mockResolvedValue({ created: true });
    const view = await renderAnonymous();
    await fireEvent.press(view.getByLabelText("手机号登录"));
    await fireEvent.changeText(view.getByLabelText("手机号"), "13800138000");
    await fireEvent.changeText(view.getByLabelText("短信验证码"), "123456");

    await fireEvent.press(view.getByRole("button", { name: "登录 / 注册" }));

    await waitFor(() => expect(mockSignInWithPhone).toHaveBeenCalledWith("13800138000", "123456"));
  });

  it("验证码错误 → 内联「验证码错误或已过期…」，不露英文且按钮恢复可点", async () => {
    mockSignInWithPhone.mockRejectedValue(
      new ApiRequestError("验证码错误或已过期，请重新获取", "AUTH_CODE_INVALID", 401),
    );
    const view = await renderAnonymous();
    await fireEvent.press(view.getByLabelText("手机号登录"));
    await fireEvent.changeText(view.getByLabelText("手机号"), "13800138000");
    await fireEvent.changeText(view.getByLabelText("短信验证码"), "000000");

    await fireEvent.press(view.getByRole("button", { name: "登录 / 注册" }));

    expect(await view.findByText("验证码错误或已过期，请重新获取")).toBeTruthy();
    expect(view.getByText("登录 / 注册")).toBeTruthy();
  });
});
