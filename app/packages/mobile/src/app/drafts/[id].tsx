import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { toast } from "sonner-native";
import { CONFIRM_STATUS_META } from "@anxin/shared";
import {
  buildConfirm,
  confirmDraft,
  fetchDraft,
  initialConfirmState,
  rejectDraft,
  unmetReasons,
  useIntakeSession,
  type ConfirmFormState,
  type DraftDto,
} from "@anxin/core";
import { queryClient } from "@/lib/query";
import { HealthCard } from "@/components/domain/draft/HealthCard";
import { IdentityCard } from "@/components/domain/draft/IdentityCard";
import { NoPlanCard } from "@/components/domain/draft/NoPlanCard";
import { OriginalPanel } from "@/components/domain/draft/OriginalPanel";
import {
  ConfirmResultDialog,
  InteractionCard,
  type ConfirmResult,
} from "@/components/domain/draft/RiskCards";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";

/**
 * 草稿确认页（05e §2-T6-c）——录入主线的**唯一闸门**，语义与 web 端 `Draft.tsx` 同源：
 * 表单初值、缺项判定、闸门清单与 confirm 入参一律走 core，本文件只做渲染与 IO。
 * 区块组成与渲染顺序逐块对齐 web：原文对照 → 药品身份 → （有计划：医嘱/时间点｜无计划：仅建档）
 * → 健康建议 → 相互作用 →（处方笺另有范围校验与使用人，归 T6-d）→ 闸门。
 *
 * 入口 B 的 `planDraft` 恒为 null，故本片实到的是「仅建档」那条分支；确认后端上不带计划时
 * 跳 `/box?plan=<drugId>` 由药箱页直接弹建计划弹窗（两步式录入，同时闭合 05d §2.7 的尾巴）。
 */
type Page =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; draft: DraftDto };

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
          message: error instanceof Error ? error.message : "草稿不存在或已被处理。",
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
        <Text className="text-xl font-bold text-risk-l4">草稿读取失败</Text>
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
  const [mismatchOpen, setMismatchOpen] = useState(false);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  // 原图只在本机会话内存（core 的 intakeSession，绝不持久化）；取不到 → 文字对照降级
  const imageUrl = useIntakeSession((s) => s.imageByDraftId[draft.id]);

  const patch = (partial: Partial<ConfirmFormState>) =>
    setState((prev) => ({ ...prev, ...partial }));

  const reasons = useMemo(() => unmetReasons(payload, state), [payload, state]);
  const statusMeta = CONFIRM_STATUS_META[payload.drugDraft.confirmStatus ?? "manual"];
  const drugName =
    state.manual.genericName || payload.drugDraft.genericName || payload.item?.drugName || "本药";

  /** 确认/拒绝都会改动药箱、计划、今日任务与健康档 —— 五个键一起失效（web Draft.tsx:98-102 同口径）。 */
  const invalidate = () => {
    for (const key of [["drugs"], ["plans"], ["tasks", "today"], ["profile"], ["draft", draft.id]]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  /** 确认后跳转：带计划 → 药箱；无计划（入口 B / 降级）→ 药箱并直接打开该药的计划弹窗。 */
  function goBox(res: ConfirmResult) {
    if (res.planId) {
      toast.success("已确认：药品已入药箱，计划已生效");
      router.replace("/box");
      return;
    }
    toast.success("已确认：药品已入药箱。请为该药手动创建计划（药盒/标签用法不会被自动抄录）");
    router.replace(`/box?plan=${res.drugId}`);
  }

  async function onConfirm() {
    setBusy("confirm");
    try {
      const res = await confirmDraft(draft.id, buildConfirm(payload, state));
      useIntakeSession.getState().clear([draft.id]);
      invalidate();
      const risky = (res.interactions?.hits.length ?? 0) > 0 || res.dosageRange?.status === "exceed";
      if (risky) {
        // 有风险发现 → 跳转前让用户真的看到（只标注不阻止）；此时不切只读态，见下面的 `&& !result`
        setBusy("");
        setResult(res);
        return;
      }
      goBox(res);
    } catch {
      setBusy(""); // 文案已由 ApiNotifier 提示（core 统一出口），此处只解除按钮忙碌态
    }
  }

  async function onReject(reason: string) {
    setBusy("reject");
    try {
      await rejectDraft(draft.id, reason);
      useIntakeSession.getState().clear([draft.id]);
      invalidate();
      setMismatchOpen(false);
      if (reason.includes("手动建档")) {
        toast.info("已标记信息不符，请在药箱页手动建档");
        router.replace("/box?manual=1");
        return;
      }
      toast.info("已标记信息不符，请重新拍摄");
      // 重新拍摄要回到「这个草稿所属的入口」，而不是固定药盒入口（对齐 web 的跳转分叉）
      router.replace(payload.type === "prescription" ? "/intake/rx" : "/intake/drug");
    } catch {
      setBusy("");
    }
  }

  // 已确认/已拒绝 → 只读态（防重复操作）。例外：刚确认完、正展示重跑规则检查结果时不切只读，
  // 否则 invalidate 回读到 status=confirmed 会把本页提前换成只读卡、结果弹窗还没被看到就被卸载。
  if (draft.status !== "pending" && !result) {
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
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48, paddingTop: 16 }}
      >
        <Text className="text-xs font-bold uppercase tracking-[2px] text-primary">
          逐项核对 · {payload.entry === "A" ? "处方笺" : "药盒"}
        </Text>
        <Text className="mt-1 text-2xl font-bold text-foreground">
          草稿确认{payload.item ? `：${payload.item.drugName}` : ""}
        </Text>
        <Text className="mt-1 text-sm leading-5 text-muted-foreground">
          凡进档案，最后一道门是你 —— 用量、频次、疗程三项无差别逐项核对，不因识别置信度高而跳过。
        </Text>

        <View className="mt-3 flex-row items-center gap-2">
          <View className="rounded-full bg-secondary px-3 py-1">
            <Text
              className="text-xs font-semibold text-secondary-foreground"
              accessibilityLabel={statusMeta.hint}
            >
              {statusMeta.label}
            </Text>
          </View>
        </View>

        {payload.degraded ? (
          <View className="mt-4 rounded-xl border-2 border-risk-l4 bg-risk-l4-tint p-3">
            <Text className="text-sm leading-5 text-foreground">
              识别降级（{payload.degraded.code}）：{payload.degraded.message}
            </Text>
          </View>
        ) : null}

        <View className="mt-4 gap-4">
          <OriginalPanel payload={payload} imageUrl={imageUrl} />
          <IdentityCard payload={payload} state={state} patch={patch} />
          {payload.planDraft ? null : <NoPlanCard payload={payload} />}
          <HealthCard payload={payload} state={state} patch={patch} />
          <InteractionCard result={payload.interactions ?? null} />
        </View>

        <View className="mt-6 rounded-2xl border border-border bg-card p-4">
          {reasons.length > 0 ? (
            <View className="mb-3 gap-1">
              {reasons.map((reason) => (
                <Text key={reason} className="text-sm leading-5 text-foreground">
                  · {reason}
                </Text>
              ))}
            </View>
          ) : null}
          <View className="flex-row gap-3">
            <Pressable
              accessibilityRole="button"
              disabled={busy !== ""}
              onPress={() => setMismatchOpen(true)}
              className="min-h-[56px] flex-1 items-center justify-center rounded-xl border border-border bg-background active:opacity-80"
            >
              <Text className="text-lg font-medium text-foreground">信息不符</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={reasons.length > 0 || busy !== ""}
              onPress={onConfirm}
              className={`min-h-[56px] flex-[2] items-center justify-center rounded-xl bg-primary active:opacity-80 ${
                reasons.length > 0 || busy !== "" ? "opacity-50" : ""
              }`}
            >
              <Text className="text-lg font-semibold text-primary-foreground">
                {busy === "confirm"
                  ? "正在写入…"
                  : payload.planDraft
                    ? "确认建档并生效计划"
                    : "确认建档（计划稍后手动创建）"}
              </Text>
            </Pressable>
          </View>
          <Text className="mt-3 text-xs leading-5 text-muted-foreground">
            确认即留痕：药品 ID、确认时间、确认方式与关键字段快照写入来源记录；
            医嘱字段若被你修正，标注会从「抄录」降为「自填」。
          </Text>
          {/* §6 第 15 条：物理返回的语义要在界面上说一句，别让人猜。 */}
          <Text className="mt-1 text-xs leading-5 text-muted-foreground">
            按返回键不会丢掉这份草稿，回到上一步还能继续核对其它草稿；但这页上还没提交的修改不会保留。
          </Text>
        </View>

        <Stack.Screen options={{ title: "草稿确认" }} />
      </ScrollView>

      <Dialog open={mismatchOpen} onOpenChange={(o) => !o && setMismatchOpen(false)}>
        <DialogContent className="max-h-[88vh]">
          <DialogHeader>
            <DialogTitle className="text-xl text-card-foreground">信息不符</DialogTitle>
            <DialogDescription className="text-sm leading-5 text-muted-foreground">
              识别结果与实物不一致时，回到重拍或手动建档 —— 系统不猜测。本草稿会被标记为已拒绝并留痕。
            </DialogDescription>
          </DialogHeader>
          <View className="gap-2">
            <Pressable
              accessibilityRole="button"
              disabled={busy !== ""}
              onPress={() => onReject("用户点信息不符 → 重新拍摄")}
              className="min-h-[56px] items-center justify-center rounded-xl border border-border bg-background active:opacity-80"
            >
              <Text className="text-lg font-medium text-foreground">重新拍摄</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy !== ""}
              onPress={() => onReject("用户点信息不符 → 手动建档")}
              className="min-h-[56px] items-center justify-center rounded-xl bg-primary active:opacity-80"
            >
              <Text className="text-lg font-semibold text-primary-foreground">手动建档</Text>
            </Pressable>
          </View>
        </DialogContent>
      </Dialog>

      {result ? (
        <ConfirmResultDialog
          result={result}
          drugName={drugName}
          onDone={() => {
            setResult(null);
            goBox(result);
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
