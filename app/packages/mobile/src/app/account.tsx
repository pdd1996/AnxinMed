import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { toast } from "sonner-native";
import { toUserMessage, updateDisplayName, updatePassword, useAuthStore } from "@anxin/core";
import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordSetRequestSchema,
  UpdateMeRequestSchema,
} from "@anxin/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";

/**
 * 个人资料页（G8 增补 · P1 增补「登录密码」）· App 侧，与 web /account 同形：
 * - 姓名：读/写 users.name，保存后 router.back() 回「我的」；
 * - 登录密码：手机号验证码注册的账号默认无密码，这里补设（账号名自动取手机号，之后可用
 *   「手机号 + 密码」登录）；已有密码的账号改密必须验证当前密码。
 *
 * 校验走 shared 的 `UpdateMeRequestSchema` / `PasswordSetRequestSchema`（与服务端同一份契约）；
 * 失败留在本页内联展示（不静默当已保存）。demo 模式没有真实账号，密码区不渲染。
 */
export default function AccountPage() {
  const router = useRouter();
  const authMode = useAuthStore((s) => s.mode);
  const user = useAuthStore((s) => s.user);

  // 姓名
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 登录密码
  const hasPassword = user?.hasPassword === true;
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const trimmed = name.trim();
  const unchanged = trimmed === (user?.name ?? "");

  async function handleSave() {
    const parsed = UpdateMeRequestSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "姓名格式不正确");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await updateDisplayName(parsed.data.name);
      toast.success("姓名已更新");
      // 回「我的」：名字直接读 store，不需要再拉一次 /me。
      router.back();
    } catch (err) {
      setError(toUserMessage(err, "保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordSave() {
    const parsed = PasswordSetRequestSchema.safeParse({
      ...(hasPassword ? { oldPassword } : {}),
      password: newPassword,
    });
    if (!parsed.success) {
      setPasswordError(parsed.error.issues[0]?.message ?? "密码格式不正确");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的密码不一致");
      return;
    }
    setPasswordError(null);
    setSavingPassword(true);
    try {
      // 无密码账号（手机号注册）不传旧密码：登录态已证明手机号归属。
      await updatePassword(hasPassword ? oldPassword : undefined, parsed.data.password);
      toast.success(
        hasPassword ? "密码已更新，请使用新密码登录" : "密码已设置，可用「手机号 + 密码」登录",
      );
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(toUserMessage(err, "保存失败，请重试"));
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-2xl font-bold text-foreground">姓名</Text>
      <Text className="mt-1 text-sm leading-6 text-muted-foreground">
        「我的」页和医生端都显示这个名字，随时可以改。
      </Text>

      <Card className="mt-4 p-0">
        <CardContent className="gap-3 p-4">
          <Text className="text-sm font-semibold text-card-foreground">姓名</Text>
          <Input
            className="min-h-[52px]"
            value={name}
            onChangeText={(next) => {
              setName(next);
              setError(null);
            }}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            placeholder="如：张某某"
            accessibilityLabel="姓名"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void handleSave()}
          />
          <Text className="text-xs text-muted-foreground">最多 {DISPLAY_NAME_MAX_LENGTH} 个字</Text>

          {error ? (
            <View className="rounded-xl border border-risk-l4 bg-risk-l4-tint p-3">
              <Text className="text-sm leading-5 text-risk-l4" accessibilityRole="alert">
                {error}
              </Text>
            </View>
          ) : null}

          <Button
            className="min-h-[52px]"
            disabled={saving || unchanged}
            onPress={() => void handleSave()}
          >
            <Text className="text-base font-semibold">
              {saving ? "正在保存…" : "保存"}
            </Text>
          </Button>
        </CardContent>
      </Card>

      {authMode === "demo" ? null : (
        <>
          <Text className="mt-8 text-2xl font-bold text-foreground">登录密码</Text>
          <Text className="mt-1 text-sm leading-6 text-muted-foreground">
            {hasPassword
              ? "修改密码需要先输入当前密码；修改后请用新密码登录，当前登录不会被退出。"
              : "手机号注册的账号还没有密码；设置后可用「手机号作为账号 + 密码」登录。"}
          </Text>

          <Card className="mt-4 p-0">
            <CardContent className="gap-3 p-4">
              {hasPassword ? (
                <View className="gap-2">
                  <Text className="text-sm font-semibold text-card-foreground">当前密码</Text>
                  <Input
                    className="min-h-[52px]"
                    value={oldPassword}
                    onChangeText={(next) => {
                      setOldPassword(next);
                      setPasswordError(null);
                    }}
                    secureTextEntry
                    autoComplete="current-password"
                    textContentType="password"
                    accessibilityLabel="当前密码"
                  />
                </View>
              ) : null}

              <View className="gap-2">
                <Text className="text-sm font-semibold text-card-foreground">新密码</Text>
                <Input
                  className="min-h-[52px]"
                  value={newPassword}
                  onChangeText={(next) => {
                    setNewPassword(next);
                    setPasswordError(null);
                  }}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  placeholder={`至少 ${PASSWORD_MIN_LENGTH} 位`}
                  accessibilityLabel="新密码"
                />
                <Text className="text-xs text-muted-foreground">至少 {PASSWORD_MIN_LENGTH} 位</Text>
              </View>

              <View className="gap-2">
                <Text className="text-sm font-semibold text-card-foreground">确认新密码</Text>
                <Input
                  className="min-h-[52px]"
                  value={confirmPassword}
                  onChangeText={(next) => {
                    setConfirmPassword(next);
                    setPasswordError(null);
                  }}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  accessibilityLabel="确认新密码"
                />
              </View>

              {passwordError ? (
                <View className="rounded-xl border border-risk-l4 bg-risk-l4-tint p-3">
                  <Text className="text-sm leading-5 text-risk-l4" accessibilityRole="alert">
                    {passwordError}
                  </Text>
                </View>
              ) : null}

              <Button
                className="min-h-[52px]"
                disabled={savingPassword}
                onPress={() => void handlePasswordSave()}
              >
                <Text className="text-base font-semibold">
                  {savingPassword ? "正在保存…" : hasPassword ? "修改密码" : "设置密码"}
                </Text>
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </ScrollView>
  );
}
