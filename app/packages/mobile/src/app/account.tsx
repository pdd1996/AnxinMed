import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { toast } from "sonner-native";
import { toUserMessage, updateDisplayName, useAuthStore } from "@anxin/core";
import { DISPLAY_NAME_MAX_LENGTH, UpdateMeRequestSchema } from "@anxin/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";

/**
 * 个人资料页（G8 增补 · App 侧）：只承载「身份资料」——当前是姓名，头像以后加在同一页。
 * 登录密码不在这里：密码是安全设置，入口在「设置 → 账号与安全 → 登录密码」（P1 增补起）。
 *
 * 校验走 shared 的 `UpdateMeRequestSchema`（与服务端同一份契约）；保存成功后 router.back()
 * 回「我的」，头部读登录态 store 即是新名字。失败留在本页并给出中文原因（不静默当已保存）。
 */
export default function AccountPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-sm leading-6 text-muted-foreground">
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
    </ScrollView>
  );
}
