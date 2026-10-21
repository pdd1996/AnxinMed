import { Pressable, Text, TextInput, View } from "react-native";
import { useUnstableNativeVariable } from "nativewind";
import { CircleAlert, Hand, Pill, ShieldCheck, Undo2 } from "lucide-react-native";
import { DOSE_UNITS } from "@anxin/shared";
import {
  identityNeedsManual,
  infoConflicts,
  isManualMode,
  selectableCandidates,
  type ConfirmFormState,
  type DraftPayload,
} from "@anxin/core";
import { DraftCard, DraftRow, WarnNote } from "@/components/domain/draft/DraftCard";

/**
 * 药品身份卡（M5-T6c，对齐 web `draft/IdentityCard.tsx`，PRD §7.2.5 / §8.2）：药名 + 规格 + 剂型三项严格核对。
 * 唯一匹配 → 展示库条目；多候选/冲突 → 冲突清单**系统不选边**，由用户选定或改手动建档；
 * 无匹配 → 手动建档（标注「未经 OCR 确认」，AI 个性化咨询不可用）；needsManual 覆盖的身份字段一律留空。
 * RN 侧的唯一按钮是「库存单位」：web 的 `<select>` 无对应控件，照 `ManualDrugModal` 的 chip 单选。
 */
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
  const riskL2 = useUnstableNativeVariable("--risk-l2");
  const riskL3 = useUnstableNativeVariable("--risk-l3");
  const muted = useUnstableNativeVariable("--muted-foreground");

  const candidates = selectableCandidates(payload);
  const manualMode = isManualMode(payload, state);
  const unique = payload.match?.status === "unique" ? payload.match.match : null;
  const infos = infoConflicts(payload);
  const identity = payload.identity ?? null;

  const fieldClass =
    "mt-1 min-h-[48px] rounded-xl border border-border bg-background px-3 py-2 text-base text-foreground";

  return (
    <DraftCard
      icon={<Pill size={18} color={primary} importantForAccessibility="no" />}
      title="药品身份"
      subtitle="身份线 · 药名 + 规格 + 剂型三项严格核对"
    >
      {manualMode ? (
        <View className="gap-3">
          <WarnNote
            icon={<Hand size={16} color={riskL3} importantForAccessibility="no" style={{ marginTop: 2 }} />}
          >
            身份线无唯一匹配 —— 请对照药品实物手动建档。该药将标注「未经 OCR 确认」，AI
            个性化咨询不可用，仅可做 L0 资料查询。
          </WarnNote>

          <View className="gap-1">
            <Text className="text-sm text-muted-foreground">药名</Text>
            <TextInput
              className={fieldClass}
              value={state.manual.genericName}
              onChangeText={(v) => patch({ manual: { ...state.manual, genericName: v } })}
              placeholder={
                identityNeedsManual(payload, "genericName") ? "原文未识别到，请照着药盒填写" : "请核对识别值"
              }
              placeholderTextColor="#9ca3af"
            />
          </View>
          <View className="gap-1">
            <Text className="text-sm text-muted-foreground">规格</Text>
            <TextInput
              className={fieldClass}
              value={state.manual.specification}
              onChangeText={(v) => patch({ manual: { ...state.manual, specification: v } })}
              placeholder="如：0.1%（10mL：10mg）"
              placeholderTextColor="#9ca3af"
            />
          </View>
          <View className="gap-1">
            <Text className="text-sm text-muted-foreground">剂型</Text>
            <TextInput
              className={fieldClass}
              value={state.manual.form}
              onChangeText={(v) => patch({ manual: { ...state.manual, form: v } })}
              placeholder="如：滴眼液"
              placeholderTextColor="#9ca3af"
            />
          </View>
          <View className="gap-1">
            <Text className="text-sm text-muted-foreground">库存（可选，用于「用完为止」推算）</Text>
            <TextInput
              className={fieldClass}
              keyboardType="number-pad"
              value={state.manual.stockValue}
              onChangeText={(v) => patch({ manual: { ...state.manual, stockValue: v } })}
              accessibilityLabel="库存数量"
            />
            <View className="mt-1 flex-row flex-wrap gap-2">
              {DOSE_UNITS.map((unit) => {
                const active = state.manual.stockUnit === unit;
                return (
                  <Pressable
                    key={unit}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => patch({ manual: { ...state.manual, stockUnit: unit } })}
                    className={`min-h-[44px] items-center justify-center rounded-full px-4 ${
                      active ? "border-2 border-primary bg-secondary" : "border border-input bg-background"
                    }`}
                  >
                    <Text
                      className={`text-base ${
                        active ? "font-bold text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {unit}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {candidates.length > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => patch({ useManual: false })}
              className="min-h-[44px] flex-row items-center justify-center gap-2 rounded-xl active:opacity-80"
            >
              <Undo2 size={16} color={muted} importantForAccessibility="no" />
              <Text className="text-base text-muted-foreground">返回冲突清单选择候选</Text>
            </Pressable>
          )}
        </View>
      ) : candidates.length > 0 ? (
        <View className="gap-3">
          <WarnNote
            icon={
              <CircleAlert size={18} color={riskL3} importantForAccessibility="no" style={{ marginTop: 2 }} />
            }
          >
            冲突清单 —— 系统不选边。请核对药品实物（包装盒上的规格 / 剂型 / 厂家）后选择一致的一条。
          </WarnNote>

          {(payload.conflicts ?? [])
            .filter((c) => (c.candidates ?? []).length > 0)
            .map((conflict, idx) => (
              <View key={`${conflict.type}-${idx}`} className="gap-1">
                <View className="flex-row flex-wrap items-center gap-2">
                  <View className="rounded-full bg-secondary px-2 py-0.5">
                    <Text className="text-xs font-semibold text-secondary-foreground">
                      {conflict.type === "spec" ? "规格冲突" : conflict.type === "form" ? "剂型冲突" : "多候选"}
                    </Text>
                  </View>
                  <Text className="flex-1 text-sm text-foreground">{conflict.note}</Text>
                </View>
                {(conflict.extracted || conflict.library) && (
                  <Text className="text-xs text-muted-foreground">
                    提取值：{conflict.extracted || "—"} ｜ 药品库：{conflict.library || "—"}
                  </Text>
                )}
              </View>
            ))}

          {candidates.map((c) => {
            const active = state.selectedCandidateId === c.id;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => patch({ selectedCandidateId: c.id })}
                className={`min-h-[56px] flex-row items-start gap-3 rounded-xl border p-3 ${
                  active ? "border-2 border-primary bg-secondary" : "border-input bg-background"
                }`}
              >
                {/* web 的原生 radio 在 RN 无对应控件：小圆点 + 选中勾，不单靠颜色（05d §6 第 4 条口径） */}
                <View
                  className={`mt-1 h-5 w-5 items-center justify-center rounded-full border-2 ${
                    active ? "border-primary" : "border-input"
                  }`}
                >
                  {active && <View className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-bold text-foreground">{c.genericName}</Text>
                  <Text className="mt-0.5 text-sm text-muted-foreground">
                    {c.brandName ? `${c.brandName} · ` : ""}
                    {c.specification} · {c.form}
                  </Text>
                  <Text className="mt-0.5 text-xs text-muted-foreground">
                    厂家：{c.manufacturer || "—"} · 批准文号：{c.approvalNumber || "—"}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          <Pressable
            accessibilityRole="button"
            onPress={() => patch({ useManual: true })}
            className="min-h-[44px] flex-row items-center justify-center gap-2 rounded-xl border border-border bg-background active:opacity-80"
          >
            <Hand size={16} color={muted} importantForAccessibility="no" />
            <Text className="text-base text-card-foreground">都不符 · 改用手动建档</Text>
          </Pressable>
        </View>
      ) : (
        <View className="gap-3">
          <View className="flex-row items-center gap-2">
            <ShieldCheck size={16} color={riskL2} importantForAccessibility="no" />
            <Text className="flex-1 text-sm font-semibold text-foreground">
              药品库唯一匹配 · 仍需你核对实物后确认
            </Text>
          </View>
          {unique && (
            <View className="gap-1 rounded-xl border border-border bg-background p-3">
              <Text className="mb-1 text-base font-bold text-foreground">{unique.genericName}</Text>
              <DraftRow label="商品名" value={unique.brandName ?? ""} />
              <DraftRow label="规格" value={unique.specification ?? ""} />
              <DraftRow label="剂型" value={unique.form ?? ""} />
              <DraftRow label="厂家" value={unique.manufacturer ?? ""} />
              <DraftRow label="批准文号" value={unique.approvalNumber ?? ""} />
            </View>
          )}
          {payload.match?.resolutionNote && (
            <View className="rounded-xl border border-risk-l2 bg-risk-l2-tint p-2">
              <Text className="text-xs leading-5 text-foreground">{payload.match.resolutionNote}</Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => patch({ useManual: true })}
            className="min-h-[44px] flex-row items-center justify-center gap-2 rounded-xl border border-border bg-background active:opacity-80"
          >
            <Hand size={16} color={muted} importantForAccessibility="no" />
            <Text className="text-base text-card-foreground">不是这个药 · 改用手动建档</Text>
          </Pressable>
        </View>
      )}

      {/* 识别抄录值（VLM/OCR 提取，非库条目）：供与实物对照；needsManual 覆盖项不显示值（留空待补） */}
      {identity && (
        <View className="gap-1 rounded-xl border border-dashed border-border bg-muted p-3">
          <Text className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            识别抄录值（供对照）
          </Text>
          <DraftRow label="药名" value={identity.genericName ?? ""} />
          <DraftRow label="商品名" value={identity.brandName ?? ""} />
          <DraftRow
            label="规格"
            value={identityNeedsManual(payload, "specification") ? "" : (identity.specification ?? "")}
          />
          <DraftRow label="剂型" value={identityNeedsManual(payload, "form") ? "" : (identity.form ?? "")} />
          <DraftRow label="厂家" value={identity.manufacturer ?? ""} />
          <DraftRow label="批准文号" value={identity.approvalNumber ?? ""} />
          {identity.otcFlag && <DraftRow label="类别" value="非处方药（OTC）" />}
        </View>
      )}

      {infos.map((conflict, idx) => (
        <View key={`info-${idx}`} className="rounded-xl border border-risk-l2 bg-risk-l2-tint p-2">
          <Text className="text-sm leading-5 text-foreground">{conflict.note}</Text>
        </View>
      ))}
    </DraftCard>
  );
}