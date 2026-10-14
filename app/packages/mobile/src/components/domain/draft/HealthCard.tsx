import { TextInput, Pressable, View } from "react-native";
import { Info, UserRound } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import type { ConfirmFormState, DraftPayload } from "@anxin/core";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * 健康信息「建议填入」勾选区（对齐 web `domain/draft/HealthCard.tsx`，PRD §7.1.2 入口二 / §10.2）。
 * 勾选才写入；提交的 fieldKey 一律取自 payload.healthSuggestions（清单外字段服务端 400 拒绝）。
 * 值与建议一致 → 落「处方笺抄录 · 已确认」；改过值 → 落「用户自述」（溯源判定在服务端）。
 */
export function HealthCard({
  payload,
  state,
  patch,
}: {
  payload: DraftPayload;
  state: ConfirmFormState;
  patch: (partial: Partial<ConfirmFormState>) => void;
}) {
  const primary = useUnstableNativeVariable("--primary");
  const muted = useUnstableNativeVariable("--muted-foreground");
  const suggestions = payload.healthSuggestions ?? [];
  if (suggestions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <View className="flex-row items-center gap-2">
          <Icon as={UserRound} size={20} color={primary} />
          <CardTitle className="text-lg text-card-foreground">健康信息 · 建议填入</CardTitle>
          <Text className="text-xs text-muted-foreground">勾选才写入，字段级来源标注</Text>
        </View>
      </CardHeader>
      <CardContent className="gap-3">
        {suggestions.map((s) => {
          const checked = Boolean(state.healthChecked[s.field]);
          const value = state.healthValue[s.field] ?? s.value;
          const edited = value.trim() !== s.value.trim();
          return (
            <View key={s.field} className="gap-2 rounded-xl border border-border bg-background p-3">
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={`勾选写入${s.field}`}
                onPress={() => patch({ healthChecked: { ...state.healthChecked, [s.field]: !checked } })}
                className="min-h-[44px] flex-row items-start gap-3"
              >
                <View
                  className={cn(
                    "mt-1 size-6 items-center justify-center rounded border-2",
                    checked ? "border-primary bg-primary" : "border-border bg-background",
                  )}
                >
                  {checked ? <Text className="text-sm font-bold text-primary-foreground">✓</Text> : null}
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">{s.field}</Text>
                  <Text className="mt-1 text-xs leading-5 text-muted-foreground">
                    来源：{s.source} ·{" "}
                    {edited
                      ? "你已修改，将标注为「用户自述」"
                      : "与建议一致，将标注为「处方笺抄录 · 已确认」"}
                  </Text>
                </View>
              </Pressable>
              {checked ? (
                <TextInput
                  accessibilityLabel={`${s.field}（写入值）`}
                  className="min-h-[48px] rounded-xl border border-border bg-background px-3 py-2 text-base text-foreground"
                  value={value}
                  onChangeText={(v) => patch({ healthValue: { ...state.healthValue, [s.field]: v } })}
                />
              ) : null}
            </View>
          );
        })}
        <View className="flex-row items-start gap-2">
          <Icon as={Info} size={16} color={muted} style={{ marginTop: 2 }} />
          <Text className="flex-1 text-xs leading-5 text-muted-foreground">
            产品不做诊断：「诊断」字段语义永远为「用户报告的诊断」，AI 将其视为用户提供的、未经医学验证的信息。
            不勾选即不写入，随时可在「我的 · 健康信息」手动补。
          </Text>
        </View>
      </CardContent>
    </Card>
  );
}
