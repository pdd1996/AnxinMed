import { useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { ScrollView, View } from "react-native";
import { useUnstableNativeVariable } from "nativewind";
import { ShieldAlert } from "lucide-react-native";
import { bootstrapAuth, signIn, toUserMessage, useAuthStore } from "@anxin/core";
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

/**
 * 登录门（G7）：在首用声明卡之后、路由之前确认登录态，取代 web 的「RequireAuth + /login 路由」。
 *
 * 状态机在 @anxin/core 的 useAuthStore + bootstrapAuth，本组件只做渲染分支：
 * - idle/loading：启动恢复中 → 全屏「正在检查登录状态」，避免先闪一下业务页再弹登录；
 * - error：检查本身失败（网络/服务异常）→ 说明 + 重试，不静默当作未登录；
 * - anonymous：password 模式的登录界面（就渲染在本组件里，不新增登录路由）；
 * - authenticated：直接渲染 children（demo 模式自动通过，既有本地开发行为不变）。
 *
 * error 在 core/bootstrapAuth 写入 store 前已归成中文（G8）；这里再过一次 toUserMessage
 * 只作兜底，保证任何来源的技术英文都不会直接上屏（G7 真机验收 §9.8 的返工点）。
 *
 * 登录成功后 store 变 authenticated，本组件自然重渲染为 children —— 不做任何手动跳转。
 * 退出登录（设置页）把 store 切回 anonymous，本组件同样自动切回登录界面。
 */
export function AuthGate({ children }: { children: ReactNode }) {
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
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
      // 服务端中文 message 原样透传（账号或密码错误 / 登录尝试次数过多…）；
      // 断网、超时、服务异常等英文技术错误由 core 统一换成中文，绝不原样上屏。
      setFailure(toUserMessage(err, "登录失败，请稍后重试"));
    } finally {
      setPending(false);
    }
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
            <CardDescription className="text-base leading-7">
              请输入管理员分配给你的账号和密码。
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-4">
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
                onSubmitEditing={() => void handleSubmit()}
              />
            </View>

            {failure ? (
              /* 错误内联 + role="alert"：登录失败的原因要一直在眼前，也让读屏能播报。 */
              <View
                role="alert"
                accessibilityLiveRegion="assertive"
                className="rounded-xl border border-risk-l4 bg-risk-l4-tint px-4 py-3"
              >
                <Text className="text-base leading-6 text-risk-l4">{failure}</Text>
              </View>
            ) : null}

            {/* pending 时禁用，防连点重复提交（服务端有限流，但前端不该主动打满）。 */}
            <Button
              className="min-h-[52px] w-full"
              disabled={pending}
              onPress={() => void handleSubmit()}
            >
              <Text className="text-lg">{pending ? "正在登录…" : "登录"}</Text>
            </Button>

            <Text className="text-sm leading-6 text-muted-foreground">
              账号由管理员分配；忘记密码请联系管理员重置。
            </Text>
          </CardContent>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
