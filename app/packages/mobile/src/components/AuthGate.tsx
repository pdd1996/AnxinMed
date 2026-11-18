import { useEffect, useState } from "react";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Pressable, ScrollView, View } from "react-native";
import { useUnstableNativeVariable } from "nativewind";
import { ShieldAlert } from "lucide-react-native";
import { PASSWORD_MIN_LENGTH, PHONE_PATTERN, PasswordResetRequestSchema } from "@anxin/shared";
import {
  bootstrapAuth,
  requestPhoneCode,
  requestResetCode,
  resetPassword,
  signIn,
  signInWithPhone,
  toUserMessage,
  useAuthStore,
} from "@anxin/core";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";

type LoginMode = "password" | "phone";

/**
 * 登录门（G7 密码 · P1 手机号验证码）：在首用声明卡之后、路由之前确认登录态，
 * 取代 web 的「RequireAuth + /login 路由」。
 *
 * 状态机在 @anxin/core 的 useAuthStore + bootstrapAuth，本组件只做渲染分支：
 * - idle/loading：启动恢复中 → 全屏「正在检查登录状态」，避免先闪一下业务页再弹登录；
 * - error：检查本身失败（网络/服务异常）→ 说明 + 重试，不静默当作未登录；
 * - anonymous：password 模式的登录界面（密码 / 手机号验证码两种方式，渲染在本组件里，不新增路由）；
 * - authenticated：直接渲染 children（demo 模式自动通过，既有本地开发行为不变）。
 *
 * error 在 core/bootstrapAuth 写入 store 前已归成中文（G8）；这里再过一次 toUserMessage
 * 只作兜底，保证任何来源的技术英文都不会直接上屏。
 *
 * 手机号方式为「验证码即注册」：未注册手机号验码通过后由服务端自动建号并发会话。
 *
 * 登录成功后 store 变 authenticated，本组件自然重渲染为 children —— 不做任何手动跳转。
 * 退出登录（我的页）把 store 切回 anonymous，本组件同样自动切回登录界面。
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);

  // 启动恢复只跑一次；bootstrapAuth 对 loading/authenticated 幂等，error 状态下的重试由用户点击触发。
  useEffect(() => {
    void bootstrapAuth();
  }, []);

  if (status === "idle" || status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-background p-4">
        <Text className="text-base text-muted-foreground">正在检查登录状态…</Text>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View className="flex-1 items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">暂时无法确认登录状态</CardTitle>
            <CardDescription className="text-base leading-7">
              {toUserMessage(error, "请检查网络或服务器连接后重试。")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="min-h-[52px] w-full" onPress={() => void bootstrapAuth()}>
              <Text className="text-lg">重试</Text>
            </Button>
          </CardContent>
        </Card>
      </View>
    );
  }

  if (status === "anonymous") return <LoginScreen />;

  return <>{children}</>;
}

/**
 * 登录界面（只在 anonymous 时挂载）：照 web `routes/Login.tsx` 的文案与校验，渲染换成 RN 组件。
 * 适老化：大字、触控目标 ≥52px、错误内联留在表单里（读屏也能播报），不做 toast 一闪而过。
 */
function LoginScreen() {
  // 品牌色圆底上的图标色：图标是 SVG，套不了 class，直接取 --primary-foreground（随深浅色翻转）。
  const iconOnPrimary = useUnstableNativeVariable("--primary-foreground");
  const [mode, setMode] = useState<LoginMode>("password");
  const [failure, setFailure] = useState<string | null>(null);

  // 密码登录
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  // 手机号验证码登录（验证码即注册）
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [phonePending, setPhonePending] = useState(false);
  /** 重发倒计时（秒），由服务端返回的 cooldownSec 初始化。 */
  const [cooldown, setCooldown] = useState(0);

  // 找回密码（未登录）：独立表单状态，避免与登录表单互相污染。
  const [resetMode, setResetMode] = useState(false);
  const [resetPhone, setResetPhone] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetSending, setResetSending] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);

  // 倒计时：每秒减一（卸载自动清理，避免离开登录页后 setState）。
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = setTimeout(() => setResetCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resetCooldown]);

  function switchMode(next: LoginMode) {
    setMode(next);
    setFailure(null);
  }

  async function handlePasswordSubmit() {
    if (pending) return;
    const account = username.trim();
    if (!account || !password) {
      setFailure("请输入账号和密码");
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      await signIn(account, password);
      // 成功后 store 切 authenticated → AuthGate 重渲染为 children，这里无需跳转；
      // 失败文案直接用服务端返回（账号或密码错误 / 登录尝试次数过多…），网络异常换人话。
    } catch (err) {
      setFailure(toUserMessage(err, "登录失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  async function handleSendCode() {
    if (sending || cooldown > 0) return;
    const value = phone.trim();
    if (!PHONE_PATTERN.test(value)) {
      setFailure("请输入 11 位手机号");
      return;
    }
    setSending(true);
    setFailure(null);
    try {
      const data = await requestPhoneCode(value);
      setCooldown(data.cooldownSec);
    } catch (err) {
      // SMS_LIMITED / SMS_SEND_FAILED / SMS_NOT_CONFIGURED 的中文 message 原样透传。
      setFailure(toUserMessage(err, "验证码发送失败，请稍后重试"));
    } finally {
      setSending(false);
    }
  }

  async function handlePhoneSubmit() {
    if (phonePending) return;
    const phoneValue = phone.trim();
    const codeValue = code.trim();
    if (!PHONE_PATTERN.test(phoneValue)) {
      setFailure("请输入 11 位手机号");
      return;
    }
    if (!/^\d{4,8}$/.test(codeValue)) {
      setFailure("请输入短信验证码");
      return;
    }
    setPhonePending(true);
    setFailure(null);
    try {
      // 验证码即注册：首次通过核验由服务端自动建号。
      await signInWithPhone(phoneValue, codeValue);
    } catch (err) {
      setFailure(toUserMessage(err, "登录失败，请稍后重试"));
    } finally {
      setPhonePending(false);
    }
  }

  async function handleSendResetCode() {
    if (resetSending || resetCooldown > 0) return;
    const value = resetPhone.trim();
    if (!PHONE_PATTERN.test(value)) {
      setFailure("请输入 11 位手机号");
      return;
    }
    setResetSending(true);
    setFailure(null);
    try {
      const data = await requestResetCode(value);
      setResetCooldown(data.cooldownSec);
    } catch (err) {
      setFailure(toUserMessage(err, "验证码发送失败，请稍后重试"));
    } finally {
      setResetSending(false);
    }
  }

  async function handleResetSubmit() {
    if (resetPending) return;
    const parsed = PasswordResetRequestSchema.safeParse({
      phone: resetPhone.trim(),
      code: resetCode.trim(),
      password: resetNewPassword,
    });
    if (!parsed.success) {
      setFailure(parsed.error.issues[0]?.message ?? "请检查输入");
      return;
    }
    if (resetNewPassword !== resetConfirm) {
      setFailure("两次输入的密码不一致");
      return;
    }
    setResetPending(true);
    setFailure(null);
    try {
      // 重置成功即登录（服务端已清该账号旧会话并发新会话）。
      await resetPassword(parsed.data.phone, parsed.data.code, parsed.data.password);
    } catch (err) {
      setFailure(toUserMessage(err, "重置失败，请稍后重试"));
    } finally {
      setResetPending(false);
    }
  }

  function modeButton(key: LoginMode, label: string) {
    const active = mode === key;
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onPress={() => switchMode(key)}
        className={
          active
            ? "min-h-[48px] flex-1 items-center justify-center rounded-lg bg-background px-2 py-2"
            : "min-h-[48px] flex-1 items-center justify-center rounded-lg px-2 py-2"
        }
      >
        <Text
          className={
            active
              ? "text-base font-semibold text-foreground"
              : "text-base text-muted-foreground"
          }
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    /* edge-to-edge 下窗口不随输入法缩放，键盘会盖住底部登录钮；keyboard-controller 的
       KeyboardAvoidingView 与弹窗同一套避让（见 components/ui/dialog.tsx:56-63）。 */
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-background"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          alignItems: "center",
          flexGrow: 1,
          justifyContent: "center",
          padding: 16,
        }}
      >
        <Card className="w-full max-w-md">
          <CardHeader>
            <View className="mb-2 h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <ShieldAlert size={24} color={iconOnPrimary} importantForAccessibility="no" />
            </View>
            <CardTitle className="text-2xl">登录安心用药</CardTitle>
            <CardDescription className="text-base leading-7">请选择登录方式</CardDescription>
          </CardHeader>
          <CardContent className="gap-4">
            {resetMode ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="返回密码登录"
                  onPress={() => {
                    setResetMode(false);
                    setFailure(null);
                  }}
                  className="min-h-[44px] flex-row items-center self-start"
                >
                  <Text className="text-base font-semibold text-muted-foreground">
                    ← 返回密码登录
                  </Text>
                </Pressable>

                <View className="gap-1">
                  <Text className="text-xl font-bold text-foreground">找回密码</Text>
                  <Text className="text-sm leading-6 text-muted-foreground">
                    用注册手机号收验证码，验证通过后设置新密码；重置成功会自动登录。
                  </Text>
                </View>

                <View className="gap-2">
                  <Label className="text-base">手机号</Label>
                  <Input
                    className="min-h-[52px] text-lg"
                    value={resetPhone}
                    onChangeText={(text) => setResetPhone(text.replace(/\D/g, ""))}
                    placeholder="请输入 11 位手机号"
                    keyboardType="number-pad"
                    maxLength={11}
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                    editable={!resetPending}
                    accessibilityLabel="找回手机号"
                  />
                </View>

                <View className="gap-2">
                  <Label className="text-base">短信验证码</Label>
                  <View className="flex-row gap-2">
                    <Input
                      className="min-h-[52px] flex-1 text-lg"
                      value={resetCode}
                      onChangeText={(text) => setResetCode(text.replace(/\D/g, ""))}
                      placeholder="请输入验证码"
                      keyboardType="number-pad"
                      maxLength={8}
                      autoComplete="one-time-code"
                      textContentType="oneTimeCode"
                      editable={!resetPending}
                      accessibilityLabel="找回验证码"
                    />
                    <Button
                      variant="outline"
                      className="min-h-[52px] shrink-0 px-4"
                      disabled={resetSending || resetCooldown > 0 || resetPending}
                      onPress={() => void handleSendResetCode()}
                    >
                      <Text className="text-base">
                        {resetSending ? "发送中…" : resetCooldown > 0 ? `${resetCooldown} 秒后重发` : "获取验证码"}
                      </Text>
                    </Button>
                  </View>
                  <Text className="text-sm leading-6 text-muted-foreground">
                    如该手机号已注册，验证码将发送到该号码。
                  </Text>
                </View>

                <View className="gap-2">
                  <Label className="text-base">新密码</Label>
                  <Input
                    className="min-h-[52px] text-lg"
                    value={resetNewPassword}
                    onChangeText={setResetNewPassword}
                    placeholder={`至少 ${PASSWORD_MIN_LENGTH} 位`}
                    secureTextEntry
                    autoComplete="new-password"
                    textContentType="newPassword"
                    editable={!resetPending}
                    accessibilityLabel="找回新密码"
                  />
                  <Text className="text-xs text-muted-foreground">至少 {PASSWORD_MIN_LENGTH} 位</Text>
                </View>

                <View className="gap-2">
                  <Label className="text-base">确认新密码</Label>
                  <Input
                    className="min-h-[52px] text-lg"
                    value={resetConfirm}
                    onChangeText={setResetConfirm}
                    secureTextEntry
                    autoComplete="new-password"
                    textContentType="newPassword"
                    editable={!resetPending}
                    accessibilityLabel="找回确认密码"
                  />
                </View>

                {failure ? <FailureBox message={failure} /> : null}

                <Button
                  className="min-h-[52px] w-full"
                  disabled={resetPending}
                  onPress={() => void handleResetSubmit()}
                >
                  <Text className="text-lg">{resetPending ? "正在重置…" : "重置密码并登录"}</Text>
                </Button>
              </>
            ) : (
              <>
                <View className="mb-1 flex-row gap-1 rounded-xl bg-muted p-1">
                  {modeButton("password", "密码登录")}
                  {modeButton("phone", "手机号登录")}
                </View>

                {mode === "password" ? (
              <>
                <View className="gap-2">
                  <Label className="text-base">账号</Label>
                  <Input
                    className="min-h-[52px] text-lg"
                    value={username}
                    onChangeText={setUsername}
                    placeholder="请输入账号"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    editable={!pending}
                    accessibilityLabel="账号"
                  />
                </View>

                <View className="gap-2">
                  <Label className="text-base">密码</Label>
                  <Input
                    className="min-h-[52px] text-lg"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="请输入密码"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="current-password"
                    textContentType="password"
                    editable={!pending}
                    accessibilityLabel="密码"
                    returnKeyType="go"
                    onSubmitEditing={() => void handlePasswordSubmit()}
                  />
                </View>

                {failure ? <FailureBox message={failure} /> : null}

                {/* pending 时禁用，防连点重复提交（服务端有限流，但前端不该主动打满）。 */}
                <Button
                  className="min-h-[52px] w-full"
                  disabled={pending}
                  onPress={() => void handlePasswordSubmit()}
                >
                  <Text className="text-lg">{pending ? "正在登录…" : "登录"}</Text>
                </Button>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="忘记密码"
                  onPress={() => {
                    setResetMode(true);
                    setFailure(null);
                  }}
                  className="min-h-[44px] items-center justify-center px-2"
                >
                  <Text className="text-base font-medium text-primary">
                    忘记密码？用手机号找回
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <View className="gap-2">
                  <Label className="text-base">手机号</Label>
                  <Input
                    className="min-h-[52px] text-lg"
                    value={phone}
                    onChangeText={(text) => setPhone(text.replace(/\D/g, ""))}
                    placeholder="请输入 11 位手机号"
                    keyboardType="number-pad"
                    maxLength={11}
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                    editable={!phonePending}
                    accessibilityLabel="手机号"
                  />
                </View>

                <View className="gap-2">
                  <Label className="text-base">短信验证码</Label>
                  <View className="flex-row gap-2">
                    <Input
                      className="min-h-[52px] flex-1 text-lg"
                      value={code}
                      onChangeText={(text) => setCode(text.replace(/\D/g, ""))}
                      placeholder="请输入验证码"
                      keyboardType="number-pad"
                      maxLength={8}
                      autoComplete="one-time-code"
                      textContentType="oneTimeCode"
                      editable={!phonePending}
                      accessibilityLabel="短信验证码"
                    />
                    <Button
                      variant="outline"
                      className="min-h-[52px] shrink-0 px-4"
                      disabled={sending || cooldown > 0 || phonePending}
                      onPress={() => void handleSendCode()}
                    >
                      <Text className="text-base">
                        {sending ? "发送中…" : cooldown > 0 ? `${cooldown} 秒后重发` : "获取验证码"}
                      </Text>
                    </Button>
                  </View>
                  <Text className="text-sm leading-6 text-muted-foreground">
                    未注册的手机号验证通过后将自动创建账号。
                  </Text>
                </View>

                {failure ? <FailureBox message={failure} /> : null}

                <Button
                  className="min-h-[52px] w-full"
                  disabled={phonePending}
                  onPress={() => void handlePhoneSubmit()}
                >
                  <Text className="text-lg">{phonePending ? "正在登录…" : "登录 / 注册"}</Text>
                </Button>
              </>
            )}
              </>
            )}
          </CardContent>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** 登录失败提示（内联 + role=alert：原因要一直在眼前，也让读屏能播报）。 */
function FailureBox({ message }: { message: string }) {
  return (
    <View
      role="alert"
      accessibilityLiveRegion="assertive"
      className="rounded-xl border border-risk-l4 bg-risk-l4-tint px-4 py-3"
    >
      <Text className="text-base leading-6 text-risk-l4">{message}</Text>
    </View>
  );
}
