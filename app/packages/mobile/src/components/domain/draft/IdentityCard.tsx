import { Pressable, ScrollView, TextInput, View } from "react-native";
import { CircleAlert, Hand, Pill, ShieldCheck, Undo2 } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { DOSE_UNITS } from "@anxin/shared";
import {
  identityNeedsManual,
  infoConflicts,
  isManualMode,
  selectableCandidates,
  type ConfirmFormState,
  type DraftPayload,
} from "@anxin/core";
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
 * 药品身份卡（对齐 web `domain/draft/IdentityCard.tsx`，PRD §7.2.5 / §8.2）。
 * 三态逐字照搬：手动建档 / 冲突清单（系统不选边）/ 库内唯一匹配；
 * 底下再挂「识别抄录值（供对照）」与 infoConflicts 两条提示。
 * needsManual 覆盖的身份字段一律留空，绝不预填猜测（初值规则在 core）。
 */

const INPUT_CLASS =
  "mt-1 min-h-[48px] rounded-xl border border-border bg-background px-3 py-2 text-base text-foreground";

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="max-w-[62%] text-right text-sm font-semibold text-foreground">
        {value || "—"}
      </Text>
    </View>
  );
}

function Note({
  tone,
  children,
}: {
  tone: "l2" | "l3";
  children: string;
}) {
  const color = useUnstableNativeVariable(tone === "l2" ? "--risk-l2" : "--risk-l3");
  return (
    <View
      className={cn(
        "flex-row items-start gap-2 rounded-xl border-2 p-3",
        tone === "l2" ? "border-risk-l2 bg-risk-l2-tint" : "border-risk-l3 bg-risk-l3-tint",
      )}
    >
      <Icon as={tone === "l2" ? ShieldCheck : CircleAlert} size={20} color={color} style={{ marginTop: 2 }} />
      <Text className="flex-1 text-sm leading-5 text-foreground">{children}</Text>
    </View>
  );
}

/** 库存单位：RN 没有原生 select，用 chip 行（范式同 PlanModal，一个元素只挂一条颜色类）。 */
function UnitChips({ value, onPress }: { value: string; onPress: (u: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-1">
      <View className="flex-row gap-2">
        {DOSE_UNITS.map((u) => {
          const active = value === u;
          return (
            <Pressable
              key={u}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`库存单位 ${u}`}
              onPress={() => onPress(u)}
              className={cn(
                "min-h-[44px] items-center justify-center rounded-xl border-2 px-4",
                active ? "border-primary bg-primary" : "border-border bg-background",
              )}
            >
              <Text className={cn("text-base font-semibold", active ? "text-primary-foreground" : "text-foreground")}>
                {u}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function IdentityCard({
  payload,
  state,
  patch,
}: {
  payload: DraftPayload;
  state: ConfirmFormState;
  patch: (partial: Partial<ConfirmFormState>) => void;
}) {
  const primary = useUnstableNativeVariable("--primary");
  const candidates = selectableCandidates(payload);
  const manualMode = isManualMode(payload, state);
  const unique = payload.match?.status === "unique" ? payload.match.match : null;
  const infos = infoConflicts(payload);
  const identity = payload.identity ?? null;

  return (
    <Card>
      <CardHeader>
        <View className="flex-row items-center gap-2">
          <Icon as={Pill} size={20} color={primary} />
          <CardTitle className="text-lg text-card-foreground">药品身份</CardTitle>
          <Text className="text-xs text-muted-foreground">
            身份线 · 药名 + 规格 + 剂型三项严格核对
          </Text>
        </View>
      </CardHeader>
      <CardContent className="gap-3">
        {manualMode ? (
          <View className="gap-3">
            <Note tone="l3">
              身份线无唯一匹配 —— 请对照药品实物手动建档。该药将标注「未经 OCR 确认」，AI
              个性化咨询不可用，仅可做 L0 资料查询。
            </Note>
            <View>
              <Text className="text-sm text-muted-foreground">药名</Text>
              <TextInputish
                value={state.manual.genericName}
                placeholder={
                  identityNeedsManual(payload, "genericName")
                    ? "原文未识别到，请照着药盒填写"
                    : "请核对识别值"
                }
                onChangeText={(v) => patch({ manual: { ...state.manual, genericName: v } })}
              />
            </View>
            <View>
              <Text className="text-sm text-muted-foreground">规格</Text>
              <TextInputish
                value={state.manual.specification}
                placeholder="如：0.1%（10mL：10mg）"
                onChangeText={(v) => patch({ manual: { ...state.manual, specification: v } })}
              />
            </View>
            <View>
              <Text className="text-sm text-muted-foreground">剂型</Text>
              <TextInputish
                value={state.manual.form}
                placeholder="如：滴眼液"
                onChangeText={(v) => patch({ manual: { ...state.manual, form: v } })}
              />
            </View>
            <View>
              <Text className="text-sm text-muted-foreground">库存（可选，用于「用完为止」推算）</Text>
              <TextInputish
                value={state.manual.stockValue}
                keyboardType="number-pad"
                placeholder="数量"
                onChangeText={(v) => patch({ manual: { ...state.manual, stockValue: v } })}
              />
              <Text className="mt-2 text-sm text-muted-foreground">库存单位</Text>
              <UnitChips
                value={state.manual.stockUnit}
                onPress={(u) => patch({ manual: { ...state.manual, stockUnit: u } })}
              />
            </View>
            {candidates.length > 0 ? (
              <GhostButton label="返回冲突清单选择候选" icon={Undo2} onPress={() => patch({ useManual: false })} />
            ) : null}
          </View>
        ) : candidates.length > 0 ? (
          <View className="gap-3">
            <Note tone="l3">
              冲突清单 —— 系统不选边。请核对药品实物（包装盒上的规格 / 剂型 / 厂家）后选择一致的一条。
            </Note>
            {(payload.conflicts ?? [])
              .filter((c) => (c.candidates ?? []).length > 0)
              .map((conflict, idx) => (
                <View key={`${conflict.type}-${idx}`} className="gap-1">
                  <View className="flex-row items-center gap-2">
                    <View className="rounded-full bg-secondary px-2 py-0.5">
                      <Text className="text-xs font-semibold text-secondary-foreground">
                        {conflict.type === "spec" ? "规格冲突" : conflict.type === "form" ? "剂型冲突" : "多候选"}
                      </Text>
                    </View>
                    <Text className="flex-1 text-sm leading-5 text-foreground">{conflict.note}</Text>
                  </View>
                  {conflict.extracted || conflict.library ? (
                    <Text className="text-xs leading-5 text-muted-foreground">
                      提取值：{conflict.extracted || "—"} ｜ 药品库：{conflict.library || "—"}
                    </Text>
                  ) : null}
                </View>
              ))}
            <View className="gap-2">
              {candidates.map((cand) => {
                const active = state.selectedCandidateId === cand.id;
                return (
                  <Pressable
                    key={cand.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => patch({ selectedCandidateId: cand.id })}
                    className={cn(
                      "min-h-[56px] justify-center rounded-xl border-2 p-3",
                      active ? "border-primary bg-primary" : "border-border bg-background",
                    )}
                  >
                    <Text className={cn("text-base font-semibold", active ? "text-primary-foreground" : "text-foreground")}>
                      {cand.genericName}
                    </Text>
                    <Text className={cn("mt-1 text-sm", active ? "text-primary-foreground" : "text-muted-foreground")}>
                      {cand.brandName ? `${cand.brandName} · ` : ""}
                      {cand.specification} · {cand.form}
                    </Text>
                    <Text className={cn("mt-1 text-xs", active ? "text-primary-foreground" : "text-muted-foreground")}>
                      厂家：{cand.manufacturer || "—"} · 批准文号：{cand.approvalNumber || "—"}
                    </Text>
                  </Pressable>
                );
              })}
              <OutlineButton label="都不符 · 改用手动建档" icon={Hand} onPress={() => patch({ useManual: true })} />
            </View>
          </View>
        ) : (
          <View className="gap-3">
            <Note tone="l2">药品库唯一匹配 · 仍需你核对实物后确认</Note>
            {unique ? (
              <View className="gap-1 rounded-xl border border-border bg-background p-3">
                <Text className="mb-1 text-base font-bold text-foreground">{unique.genericName}</Text>
                <FieldRow label="商品名" value={unique.brandName} />
                <FieldRow label="规格" value={unique.specification} />
                <FieldRow label="剂型" value={unique.form} />
                <FieldRow label="厂家" value={unique.manufacturer} />
                <FieldRow label="批准文号" value={unique.approvalNumber} />
              </View>
            ) : null}
            {payload.match?.resolutionNote ? (
              <View className="rounded-xl border-2 border-risk-l2 bg-risk-l2-tint p-2">
                <Text className="text-xs leading-5 text-foreground">{payload.match.resolutionNote}</Text>
              </View>
            ) : null}
            <OutlineButton label="不是这个药 · 改用手动建档" icon={Hand} onPress={() => patch({ useManual: true })} />
          </View>
        )}

        {identity ? (
          <View className="gap-1 rounded-xl border border-dashed border-border bg-muted p-3">
            <Text className="mb-1 text-xs font-bold uppercase tracking-[1px] text-muted-foreground">
              识别抄录值（供对照）
            </Text>
            <FieldRow label="药名" value={identity.genericName} />
            <FieldRow label="商品名" value={identity.brandName} />
            <FieldRow
              label="规格"
              value={identityNeedsManual(payload, "specification") ? "" : identity.specification}
            />
            <FieldRow label="剂型" value={identityNeedsManual(payload, "form") ? "" : identity.form} />
            <FieldRow label="厂家" value={identity.manufacturer} />
            <FieldRow label="批准文号" value={identity.approvalNumber} />
            {identity.otcFlag ? <FieldRow label="类别" value="非处方药（OTC）" /> : null}
          </View>
        ) : null}

        {infos.map((conflict, idx) => (
          <View key={`info-${idx}`} className="rounded-xl border-2 border-risk-l2 bg-risk-l2-tint p-2">
            <Text className="text-sm leading-5 text-foreground">{conflict.note}</Text>
          </View>
        ))}
      </CardContent>
    </Card>
  );
}

/** 本页统一的最小输入框（键盘避让由页面级 KAV + Dialog 负责，见 05d §2.13）。 */
function TextInputish({
  value,
  placeholder,
  keyboardType,
  onChangeText,
}: {
  value: string;
  placeholder?: string;
  keyboardType?: "default" | "number-pad";
  onChangeText: (text: string) => void;
}) {
  return (
    <TextInput
      className={INPUT_CLASS}
      value={value}
      placeholder={placeholder}
      placeholderTextColor="#9ca3af"
      keyboardType={keyboardType ?? "default"}
      onChangeText={onChangeText}
    />
  );
}

function OutlineButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: typeof Hand;
  onPress: () => void;
}) {
  const fg = useUnstableNativeVariable("--card-foreground");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-[52px] flex-row items-center justify-center gap-2 rounded-xl border border-border bg-card active:opacity-80"
    >
      <Icon as={icon} size={18} color={fg} />
      <Text className="text-base font-medium text-card-foreground">{label}</Text>
    </Pressable>
  );
}

function GhostButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: typeof Hand;
  onPress: () => void;
}) {
  const muted = useUnstableNativeVariable("--muted-foreground");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-[48px] flex-row items-center justify-center gap-2 rounded-xl active:opacity-80"
    >
      <Icon as={icon} size={18} color={muted} />
      <Text className="text-base font-medium text-muted-foreground">{label}</Text>
    </Pressable>
  );
}
