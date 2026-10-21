import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useUnstableNativeVariable } from "nativewind";
import { AlertTriangle, ChevronRight, Hand } from "lucide-react-native";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HealthCard } from "@/components/domain/draft/HealthCard";
import { IdentityCard } from "@/components/domain/draft/IdentityCard";
import { InteractionCard } from "@/components/domain/draft/InteractionCard";
import { NoPlanCard } from "@/components/domain/draft/NoPlanCard";
import { OriginalPanel } from "@/components/domain/draft/OriginalPanel";

/**
 * 草稿确认页（M5-T4 最简版 → M5-T6c 逐块对齐 web）——录入主线的**唯一闸门**，语义与 web 端 `Draft.tsx` 同源：
 * 表单初值、缺项判定、闸门清单与 confirm 入参一律走 core（`initialConfirmState` / `unmetReasons` /
 * `buildConfirm`），本文件只做渲染与 IO。凡进档案，最后一道门是用户——识别置信度再高也不跳过。
 *
 * T6-c1 已补：OriginalPanel（原图 viewer / 本条目原文 / 处方头部 / 人工补清单 / 隐私四步 / 照片类型）、
 * NoPlanCard（原自造段换掉）、页头与降级卡逐字对齐 web。身份三态/相互作用/健康/拒绝 Dialog/刷新与跳转归 T6-c2。
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
  const [rejectOpen, setRejectOpen] = useState(false);
  // 原图只在本机会话内存（core 的 intakeSession，绝不持久化）；取不到 → OriginalPanel 走文字对照降级
  const imageUrl = useIntakeSession((s) => s.imageByDraftId[draft.id]);
  // 图标不吃 TextClassContext，颜色显式给（05d §7-7）
  const iconDanger = useUnstableNativeVariable("--risk-l4");
  const iconWarn = useUnstableNativeVariable("--risk-l3");
  const iconFg = useUnstableNativeVariable("--card-foreground");
  const iconOnPrimary = useUnstableNativeVariable("--primary-foreground");

  const patch = (partial: Partial<ConfirmFormState>) =>
    setState((prev) => ({ ...prev, ...partial }));

  const reasons = useMemo(() => unmetReasons(payload, state), [payload, state]);
  const statusMeta = CONFIRM_STATUS_META[payload.drugDraft.confirmStatus ?? "manual"];
  const queryClient = useQueryClient();

  /** 确认/拒绝后药箱、今日任务与健康档案都会变（web Draft.tsx:98-102 同键集）。 */
  const invalidate = () => {
    for (const key of [["drugs"], ["plans"], ["tasks", "today"], ["profile"]]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  async function onConfirm() {
    setBusy("confirm");
    try {
      const res = await confirmDraft(draft.id, buildConfirm(payload, state));
      useIntakeSession.getState().clear([draft.id]);
      invalidate();
      const risky = (res.interactions?.hits.length ?? 0) > 0 || res.dosageRange?.status === "exceed";
      if (risky) {
        // 结果弹窗（ConfirmResultDialog）归 T6-d；本片先把风险说清楚再跳
        toast.warning("已建档：本次核对发现风险项，请在药箱内复核");
      }
      if (res.planId) {
        toast.success("已确认：药品已入药箱，计划已生效");
        router.replace("/box");
        return;
      }
      // 入口B/降级：不产生计划 → 直接打开该药的计划弹窗（两步式录入，闭合 05d §2.7 的 ?plan= 尾巴）
      if (!risky) {
        toast.success("已确认：药品已入药箱。请为该药手动创建计划（药盒/标签用法不会被自动抄录）");
      }
      router.replace(`/box?plan=${res.drugId}`);
    } catch {
      setBusy(""); // 文案已由 ApiNotifier 提示（core 统一出口），此处只解除按钮忙碌态
    }
  }

  /** 拒绝二选一（web Draft.tsx:274-292 的两条串逐字）：重拍 / 手动建档分流。 */
  async function onReject(reason: string) {
    setBusy("reject");
    try {
      await rejectDraft(draft.id, reason);
      useIntakeSession.getState().clear([draft.id]);
      invalidate();
      setRejectOpen(false);
      if (reason.includes("手动建档")) {
        toast.info("已标记信息不符，请在药箱页手动建档");
        router.replace("/box?manual=1");
        return;
      }
      toast.info("已标记信息不符，请重新拍摄");
      // 重新拍摄要回到「这个草稿所属的入口」，而不是固定药盒入口（对齐 web Draft.tsx:129-143 的跳转分叉）
      router.replace(payload.type === "prescription" ? "/intake/rx" : "/intake/drug");
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
          逐项核对 · {payload.entry === "A" ? "处方笺" : "药盒"}
        </Text>
        <Text className="mt-1 text-2xl font-bold text-foreground">
          草稿确认{payload.item ? `：${payload.item.drugName}` : ""}
        </Text>
        <Text className="mt-1 text-sm leading-5 text-muted-foreground">
          凡进档案，最后一道门是你 —— 用量、频次、疗程三项
          <Text className="font-semibold text-foreground">无差别逐项核对</Text>
          ，不因识别置信度高而跳过。
        </Text>

        <View className="mt-3 flex-row items-center gap-2">
          <View className="rounded-full bg-secondary px-3 py-1">
            <Text className="text-xs font-semibold text-secondary-foreground" accessibilityLabel={statusMeta.hint}>
              {statusMeta.label}
            </Text>
          </View>
        </View>

        {payload.degraded && (
          <View className="mt-4 flex-row items-start gap-2 rounded-xl border border-risk-l4 bg-risk-l4-tint p-3">
            <AlertTriangle
              size={18}
              color={iconDanger}
              importantForAccessibility="no"
              style={{ marginTop: 1 }}
            />
            <Text className="flex-1 text-sm leading-5 text-risk-l4">
              <Text className="font-semibold">识别降级（{payload.degraded.code}）：</Text>
              {payload.degraded.message}
            </Text>
          </View>
        )}

        <View className="mt-4">
          <OriginalPanel payload={payload} imageUrl={imageUrl} />
        </View>

        <View className="mt-5">
          <IdentityCard payload={payload} state={state} patch={patch} />
        </View>

        {/* 原自造段换成 web 的 NoPlanCard 逐字（顺带收掉「PRD 边界」工程词，05d §6-11 的回写项） */}
        {!payload.planDraft && (
          <View className="mt-5">
            <NoPlanCard payload={payload} />
          </View>
        )}

        {/* HealthCard 无建议时自身返回 null（web 同）；空态由这里拦，避免留下空壳的间距 */}
        {(payload.healthSuggestions ?? []).length > 0 && (
          <View className="mt-5">
            <HealthCard payload={payload} state={state} patch={patch} />
          </View>
        )}

        <View className="mt-5">
          <InteractionCard result={payload.interactions ?? null} />
        </View>

        <View className="mt-6 rounded-2xl border border-border bg-card p-4">
          {reasons.length > 0 && (
            <View className="mb-3 gap-1">
              {reasons.map((reason) => (
                <View key={reason} className="flex-row items-start gap-2">
                  <AlertTriangle
                    size={16}
                    color={iconWarn}
                    importantForAccessibility="no"
                    style={{ marginTop: 2 }}
                  />
                  <Text className="flex-1 text-sm leading-5 text-foreground">{reason}</Text>
                </View>
              ))}
            </View>
          )}
          {/* 次序照 web（窄屏是上下堆叠：信息不符 在上，确认 在下） */}
          <Pressable
            accessibilityRole="button"
            disabled={busy !== ""}
            onPress={() => setRejectOpen(true)}
            className="min-h-[52px] items-center justify-center rounded-xl border border-border active:opacity-80"
          >
            <Text className="text-lg font-medium text-card-foreground">信息不符</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={reasons.length > 0 || busy !== ""}
            onPress={onConfirm}
            className={`mt-2 min-h-[56px] items-center justify-center rounded-xl bg-primary active:opacity-80 ${
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
          <Text className="mt-3 text-xs leading-5 text-muted-foreground">
            确认即留痕：药品 ID、确认时间、确认方式与关键字段快照写入来源记录；医嘱字段若被你修正，标注会从「抄录」降为「自填」。
          </Text>
          {/* §6 第 15 条：物理返回的语义要在界面上说一句，别让人猜。
              返回只是退回录入屏（草稿仍在那份识别结果里），本页未提交的填写随屏幕出栈丢掉。 */}
          <Text className="mt-1 text-xs leading-5 text-muted-foreground">
            按返回键不会丢掉这份草稿，回到上一步还能继续核对其它草稿；但这页上还没提交的修改不会保留。
          </Text>
        </View>

        {/* 拒绝二选一（web Draft.tsx:265-295 的标题/说明/两条串逐字）：系统不猜，重拍或手动建档 */}
        <Dialog open={rejectOpen} onOpenChange={(next) => !next && setRejectOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>信息不符</DialogTitle>
              <DialogDescription>
                <Text className="text-base leading-6 text-foreground">
                  识别结果与实物不一致时，回到重拍或手动建档 —— 系统不猜测。本草稿会被标记为已拒绝并留痕。
                </Text>
              </DialogDescription>
            </DialogHeader>
            <View className="gap-2">
              <Pressable
                accessibilityRole="button"
                disabled={busy !== ""}
                onPress={() => void onReject("用户点信息不符 → 重新拍摄")}
                className="min-h-[52px] flex-row items-center gap-2 rounded-xl border border-border px-4 active:opacity-80"
              >
                <ChevronRight size={18} color={iconFg} importantForAccessibility="no" />
                <Text className="text-lg font-medium text-card-foreground">重新拍摄</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy !== ""}
                onPress={() => void onReject("用户点信息不符 → 手动建档")}
                className="min-h-[52px] flex-row items-center gap-2 rounded-xl bg-primary px-4 active:opacity-80"
              >
                <Hand size={18} color={iconOnPrimary} importantForAccessibility="no" />
                <Text className="text-lg font-medium text-primary-foreground">手动建档</Text>
              </Pressable>
            </View>
          </DialogContent>
        </Dialog>

        <Stack.Screen options={{ title: "草稿确认" }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

