import { Pressable, Text, TextInput, View } from "react-native";
import { useUnstableNativeVariable } from "nativewind";
import { Check, Info, UserRound } from "lucide-react-native";
import type { ConfirmFormState, DraftPayload } from "@anxin/core";
import { DraftCard } from "@/components/domain/draft/DraftCard";

/**
 * 健康信息「建议填入」勾选区（M5-T6c，对齐 web `draft/HealthCard.tsx`，PRD §7.1.2 入口二 / §10.2）。
 * 契约：提交的 fieldKey 一律取自 `payload.healthSuggestions` —— 清单外字段服务端 400 拒绝
 * （防伪造 prescription_confirmed 溯源）；值与建议一致 → 落「处方笺抄录 · 已确认」，用户改过值 → 落「用户自述」。
 * RN 侧唯一替代：web 的原生 checkbox 无对应控件，用 24px 方框 + 选中勾（accessibilityRole=checkbox）。
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
  const primaryForeground = useUnstableNativeVariable("--primary-foreground");
  const muted = useUnstableNativeVariable("--muted-foreground");

  const suggestions = payload.healthSuggestions ?? [];
  if (suggestions.length === 0) return null;

  return (
    <DraftCard
      icon={<UserRound size={18} color={primary} importantForAccessibility="no" />}
      title="健康信息 · 建议填入"
      subtitle="勾选才写入，字段级来源标注"
    >
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
              onPress={() =>
                patch({ healthChecked: { ...state.healthChecked, [s.field]: !checked } })
              }
              className="min-h-[44px] flex-row items-start gap-3"
            >
              <View
                className={`mt-0.5 h-6 w-6 items-center justify-center rounded-md border-2 ${
                  checked ? "border-primary bg-primary" : "border-input bg-background"
                }`}
              >
                {checked && (
                  <Check size={16} color={primaryForeground} importantForAccessibility="no" />
                )}
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-base font-bold text-foreground">{s.field}</Text>
                <Text className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  来源：{s.source} ·{" "}
                  {edited ? "你已修改，将标注为「用户自述」" : "与建议一致，将标注为「处方笺抄录 · 已确认」"}
                </Text>
              </View>
            </Pressable>
            {checked && (
              <TextInput
                className="min-h-[48px] rounded-xl border border-border bg-background px-3 py-2 text-base text-foreground"
                value={value}
                onChangeText={(v) => patch({ healthValue: { ...state.healthValue, [s.field]: v } })}
                accessibilityLabel={`${s.field}（写入值）`}
              />
            )}
          </View>
        );
      })}
      <View className="flex-row items-start gap-2">
        <Info size={16} color={muted} importantForAccessibility="no" style={{ marginTop: 2 }} />
        <Text className="flex-1 text-xs leading-5 text-muted-foreground">
          产品不做诊断：「诊断」字段语义永远为「用户报告的诊断」，AI 将其视为用户提供的、未经医学验证的信息。
          不勾选即不写入，随时可在「我的 · 健康信息」手动补。
        </Text>
      </View>
    </DraftCard>
  );
}