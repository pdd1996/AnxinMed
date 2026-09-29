import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { toast } from "sonner-native";
import { CONFIRM_STATUS_META } from "@anxin/shared";
import {
  buildConfirm,
  confirmDraft,
  fetchDraft,
  identityNeedsManual,
  initialConfirmState,
  isManualMode,
  rejectDraft,
  selectableCandidates,
  unmetReasons,
  useIntakeSession,
  type ConfirmFormState,
  type DraftDto,
} from "@anxin/core";

/**
 * 草稿确认页（M5-T4 最简版）——录入主线的**唯一闸门**，语义与 web 端 `Draft.tsx` 同源：
 * 表单初值、缺项判定、闸门清单与 confirm 入参一律走 core（`initialConfirmState` / `unmetReasons` /
 * `buildConfirm`），本文件只做渲染与 IO。凡进档案，最后一道门是用户——识别置信度再高也不跳过。
 *
 * T4 只覆盖入口 B（药盒：无医嘱线、无计划），故医嘱/时间点/使用人三块留 T5/T6；
 * 入口 B 的 `planDraft` 恒为 null，`unmetReasons` 也就只剩「冲突未选定」与「手动建档缺项」两类。
 */
type Page =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; draft: DraftDto };

const FIELD_CLASS =
  "mt-1 min-h-[48px] rounded-xl border border-border bg-background px-3 py-2 text-base text-foreground";

export default function DraftRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = params.id;
  const [page, setPage] = useState<Page>({ kind: "loading" });

  useEffect(() => {
    if (!id) {
      setPage({ kind: "error", message: "缺少草稿编号" });
      return;
    }
    let alive = true;
    setPage({ kind: "loading" });
    fetchDraft(id)
      .then((draft) => {
        if (alive) setPage({ kind: "ready", draft });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setPage({
          kind: "error",
          message: error instanceof Error ? error.message : "草稿读取失败",
        });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (page.kind === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-base text-muted-foreground">正在载入草稿…</Text>
      </View>
    );
  }

  if (page.kind === "error") {
    return (
      <View className="flex-1 justify-center gap-3 bg-background px-6">
        <Text className="text-xl font-bold text-red-800">草稿读取失败</Text>
        <Text className="text-sm leading-5 text-muted-foreground">{page.message}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/box")}
          className="min-h-[48px] items-center justify-center rounded-xl border border-border bg-card active:opacity-80"
        >
          <Text className="text-lg font-medium text-card-foreground">回到药箱</Text>
        </Pressable>
        <Stack.Screen options={{ title: "草稿确认" }} />
      </View>
    );
  }

  return <DraftConfirm key={page.draft.id} draft={page.draft} />;
}

function DraftConfirm({ draft }: { draft: DraftDto }) {
  const payload = draft.payload;
  const [state, setState] = useState<ConfirmFormState>(() => initialConfirmState(payload));
  const [busy, setBusy] = useState<"" | "confirm" | "reject">("");
  // 原图只在本机会话内存（core 的 intakeSession，绝不持久化）；取不到 → 纯文字核对
  const imageUrl = useIntakeSession((s) => s.imageByDraftId[draft.id]);

  const patch = (partial: Partial<ConfirmFormState>) =>
    setState((prev) => ({ ...prev, ...partial }));

  const reasons = useMemo(() => unmetReasons(payload, state), [payload, state]);
  const candidates = selectableCandidates(payload);
  const manualMode = isManualMode(payload, state);
  const statusMeta = CONFIRM_STATUS_META[payload.drugDraft.confirmStatus ?? "manual"];

  async function onConfirm() {
    setBusy("confirm");
    try {
      const res = await confirmDraft(draft.id, buildConfirm(payload, state));
      useIntakeSession.getState().clear([draft.id]);
      const risky = (res.interactions?.hits.length ?? 0) > 0 || res.dosageRange?.status === "exceed";
      if (risky) {
        toast.warning("已建档：本次核对发现风险项，请在药箱内复核计划");
      } else {
        toast.success(res.planId ? "已确认：药品已入药箱" : "已确认：药品已入药箱，请手动创建计划");
      }
      router.replace("/box");
    } catch {
      setBusy(""); // 文案已由 ApiNotifier 提示（core 统一出口），此处只解除按钮忙碌态
    }
  }

  async function onReject() {
    setBusy("reject");
    try {
      await rejectDraft(draft.id, "用户点信息不符 → 重新拍摄");
      useIntakeSession.getState().clear([draft.id]);
      toast.info("已标记信息不符，请重新拍摄");
      router.replace("/intake");
    } catch {
      setBusy("");
    }
  }

  if (draft.status !== "pending") {
    const confirmed = draft.status === "confirmed";
    return (
      <View className="flex-1 justify-center gap-3 bg-background px-6">
        <Text className="text-xl font-bold text-foreground">
          本草稿已{confirmed ? "确认" : "被标记信息不符"}
        </Text>
        <Text className="text-sm leading-5 text-muted-foreground">
          {confirmed
            ? "药品与计划已写入档案，可在药箱查看。"
            : "未写入任何档案数据；请重新拍摄或手动建档。"}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/box")}
          className="min-h-[48px] items-center justify-center rounded-xl bg-primary active:opacity-80"
        >
          <Text className="text-lg font-medium text-primary-foreground">去药箱</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48, paddingTop: 16 }}>
        <Text className="text-xs font-bold uppercase tracking-[2px] text-primary">
          唯一闸门 · {payload.entry === "A" ? "入口A 处方笺" : "入口B 药品"}
        </Text>
        <Text className="mt-1 text-2xl font-bold text-foreground">
          草稿确认{payload.item ? `：${payload.item.drugName}` : ""}
        </Text>
        <Text className="mt-1 text-sm leading-5 text-muted-foreground">
          凡进档案，最后一道门是你。请对照照片逐项核对药名、规格与剂型。
        </Text>

        <View className="mt-3 flex-row items-center gap-2">
          <View className="rounded-full bg-secondary px-3 py-1">
            <Text className="text-xs font-semibold text-secondary-foreground" accessibilityLabel={statusMeta.hint}>
              {statusMeta.label}
            </Text>
          </View>
        </View>

        {payload.degraded && (
          <View className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3">
            <Text className="text-sm leading-5 text-red-800">
              识别降级（{payload.degraded.code}）：{payload.degraded.message}
            </Text>
          </View>
        )}

        {imageUrl && (
          <Image
            source={{ uri: imageUrl }}
            resizeMode="contain"
            style={{ width: "100%", height: 240, borderRadius: 12, marginTop: 16 }}
            accessibilityLabel="本次上传的原图，用于逐项核对"
          />
        )}

        <Section title="药品身份">
          <Field
            label="通用名（药名）"
            value={state.manual.genericName}
            manual={identityNeedsManual(payload, "genericName")}
            transcribed={payload.drugDraft.genericName}
            onChangeText={(v) => patch({ manual: { ...state.manual, genericName: v } })}
          />
          <Field
            label="规格"
            value={state.manual.specification}
            manual={identityNeedsManual(payload, "specification")}
            transcribed={payload.drugDraft.specification ?? ""}
            onChangeText={(v) => patch({ manual: { ...state.manual, specification: v } })}
          />
          <Field
            label="剂型"
            value={state.manual.form}
            manual={identityNeedsManual(payload, "form")}
            transcribed={payload.drugDraft.form ?? ""}
            onChangeText={(v) => patch({ manual: { ...state.manual, form: v } })}
          />
          {!manualMode && (
            <Pressable
              accessibilityRole="button"
              onPress={() => patch({ useManual: true })}
              className="mt-3 min-h-[44px] items-center justify-center rounded-xl border border-border active:opacity-80"
            >
              <Text className="text-base text-card-foreground">以上都不对 · 改手动建档</Text>
            </Pressable>
          )}
          {manualMode && (
            <View className="mt-3 flex-row gap-3">
              <View className="flex-1">
                <Text className="text-sm text-muted-foreground">库存数量</Text>
                <TextInput
                  className={FIELD_CLASS}
                  keyboardType="number-pad"
                  value={state.manual.stockValue}
                  onChangeText={(v) => patch({ manual: { ...state.manual, stockValue: v } })}
                />
              </View>
              <View className="w-24">
                <Text className="text-sm text-muted-foreground">单位</Text>
                <TextInput
                  className={FIELD_CLASS}
                  value={state.manual.stockUnit}
                  onChangeText={(v) => patch({ manual: { ...state.manual, stockUnit: v } })}
                />
              </View>
            </View>
          )}
        </Section>

        {candidates.length > 0 && !manualMode && (
          <Section title="库内有多条候选（系统不选边）">
            {candidates.map((cand) => {
              const active = state.selectedCandidateId === cand.id;
              return (
                <Pressable
                  key={cand.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => patch({ selectedCandidateId: cand.id })}
                  className={`mt-2 min-h-[56px] justify-center rounded-xl border p-3 ${
                    active ? "border-primary bg-primary/10" : "border-border bg-background"
                  }`}
                >
                  <Text className="text-base font-semibold text-foreground">
                    {cand.genericName} {cand.specification ?? ""}
                  </Text>
                  <Text className="mt-1 text-xs text-muted-foreground">
                    {[cand.brandName, cand.form, cand.manufacturer].filter(Boolean).join(" · ")}
                  </Text>
                </Pressable>
              );
            })}
          </Section>
        )}

        {!payload.planDraft && (
          <Section title="用法用量（本照片不含）">
            <Text className="text-sm leading-5 text-muted-foreground">
              {payload.labelNotice
                ? "照片里是医院标签：标签上的用法不会被自动抄录（PRD 边界）。"
                : "药盒照片只提供药品身份，用法用量不会被自动抄录。"}
              建档后请在药箱里手动创建服药计划。
            </Text>
          </Section>
        )}

        {(payload.interactions?.hits.length ?? 0) > 0 && (
          <Section title="相互作用提示（只标注，不阻止）">
            {payload.interactions.hits.map((hit, i) => (
              <Text
                key={`${hit.level}-${i}`}
                className="mt-1 text-sm leading-5 text-amber-900"
              >
                · {hit.level}：{hit.drugNames.join(" + ")} —— {hit.note}（来源：{hit.source}）
              </Text>
            ))}
          </Section>
        )}

        <View className="mt-6 rounded-2xl border border-border bg-card p-4">
          {reasons.length > 0 && (
            <View className="mb-3 gap-1">
              {reasons.map((reason) => (
                <Text key={reason} className="text-sm leading-5 text-amber-900">
                  · {reason}
                </Text>
              ))}
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={reasons.length > 0 || busy !== ""}
            onPress={onConfirm}
            className={`min-h-[56px] items-center justify-center rounded-xl bg-primary active:opacity-80 ${
              reasons.length > 0 || busy !== "" ? "opacity-50" : ""
            }`}
          >
            <Text className="text-lg font-semibold text-primary-foreground">
              {busy === "confirm" ? "正在写入…" : "确认建档（计划稍后手动创建）"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy !== ""}
            onPress={onReject}
            className="mt-2 min-h-[52px] items-center justify-center rounded-xl border border-border active:opacity-80"
          >
            <Text className="text-lg font-medium text-card-foreground">信息不符 · 重新拍摄</Text>
          </Pressable>
          <Text className="mt-3 text-xs leading-5 text-muted-foreground">
            确认即留痕：药品、确认时间与关键字段快照写入来源记录。
          </Text>
        </View>

        <Stack.Screen options={{ title: "草稿确认" }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-5 rounded-2xl border border-border bg-card p-4">
      <Text className="text-lg font-semibold text-card-foreground">{title}</Text>
      <View className="mt-2">{children}</View>
    </View>
  );
}

/**
 * 单个身份字段：needsManual 覆盖的项**留空待填**（core 的初值规则，绝不预填猜测），
 * 其余显示抄录值供核对（T4 最简版不允许改写已识别值，改写在 T5 与 web 对齐）。
 */
function Field({
  label,
  value,
  manual,
  transcribed,
  onChangeText,
}: {
  label: string;
  value: string;
  manual: boolean;
  transcribed: string;
  onChangeText: (text: string) => void;
}) {
  if (!manual) {
    return (
      <View className="mt-3">
        <Text className="text-sm text-muted-foreground">{label}</Text>
        <Text className="mt-1 text-lg text-foreground">{transcribed || "（空）"}</Text>
      </View>
    );
  }
  return (
    <View className="mt-3">
      <Text className="text-sm text-amber-900">{label} · 需你填写（系统不预填猜测）</Text>
      <TextInput
        className={FIELD_CLASS}
        value={value}
        onChangeText={onChangeText}
        placeholder="对照药盒填写"
        placeholderTextColor="#9ca3af"
      />
    </View>
  );
}

