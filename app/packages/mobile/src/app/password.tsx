import { useState } from "react";
import { ScrollView, View } from "react-native";
import { toast } from "sonner-native";
import { toUserMessage, updatePassword, useAuthStore } from "@anxin/core";
import { PASSWORD_MIN_LENGTH, PasswordSetRequestSchema } from "@anxin/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";

/**
 * 登录密码页（P1 增补 · 从「个人资料」迁出）：设置 → 账号与安全 → 登录密码（根 stack 全屏页）。
 *
 * 为什么独立：密码是安全设置，不是身份资料；个人资料只放姓名/头像。后续手机号换绑、
 * 账号注销（G14）、登录设备管理也进「账号与安全」。
 *
 * 语义：手机号验证码注册的账号默认无密码，这里补设（账号名自动取手机号，之后可用
 * 「手机号 + 密码」登录）；已有密码的账号改密必须验证当前密码（与 API 同一契约）。
 * 校验走 shared 的 `PasswordSetRequestSchema`；失败留在本页内联展示（不静默当已保存）。
 */
export default function PasswordPage() {
  const user = useAuthStore((s) => s.user);
  const hasPassword = user?.hasPassword === true;

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const parsed = PasswordSetRequestSchema.safeParse({
      ...(hasPassword ? { oldPassword } : {}),
      password: newPassword,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "密码格式不正确");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setError(null);
    setSaving(true);
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
      setError(toUserMessage(err, "保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-sm leading-6 text-muted-foreground">
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
                  setError(null);
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
                setError(null);
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
                setError(null);
              }}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              accessibilityLabel="确认新密码"
            />
          </View>

          {error ? (
            <View className="rounded-xl border border-risk-l4 bg-risk-l4-tint p-3">
              <Text className="text-sm leading-5 text-risk-l4" accessibilityRole="alert">
                {error}
              </Text>
            </View>
          ) : null}

          <Button
            className="min-h-[52px]"
            disabled={saving}
            onPress={() => void handleSave()}
          >
            <Text className="text-base font-semibold">
              {saving ? "正在保存…" : hasPassword ? "修改密码" : "设置密码"}
            </Text>
          </Button>
        </CardContent>
      </Card>
    </ScrollView>
  );
}
