import { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Camera, Check, FileText, PackageCheck, Pill } from "lucide-react-native";
import {
  client,
  duePendingSlots,
  fetchTodayTasks,
  groupTasksByPlan,
  unwrap,
  useReminderQueue,
  type PlanGroup,
} from "@anxin/core";
import { todayStr, type RecordStatus } from "@anxin/shared";
import { TAB_BAR_BOTTOM_PAD } from "@/lib/layout";
import { apiBaseUrl, API_URL_MISSING_HINT, isApiConfigured } from "@/lib/wiring";
import { ConfirmRecordDialog, type PendingRecord } from "@/components/domain/ConfirmRecordDialog";
import { ReminderModal } from "@/components/domain/ReminderModal";
import { TaskSlotChip } from "@/components/domain/task-slot";
import { Icon } from "@/components/ui/icon";
import { useUnstableNativeVariable } from "nativewind";

type TodayData = Awaited<ReturnType<typeof fetchTodayTasks>>;

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/**
 * 日期串自己拼：web 侧用 `Intl.DateTimeFormat('zh-CN')`，而 mobile 全仓此前零处用到 Intl，
 * Hermes 的 Intl 覆盖度在本项目未验证过——拼串没有静默回落到英文格式的风险。
 */
function todayLabel(now = new Date()): string {
  return `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]}`;
}

function cycleLabel(group: PlanGroup): string {
  if (group.cycleType === "open") return "长期";
  if (group.cycleType === "stock") return "用完为止";
  return `疗程至 ${group.endDate ?? "—"}`;
}

/** 今日还有没有可操作的时点：全记录/全跳过时，提醒弹窗里没有一件事能做，不该开。 */
function hasPendingSlot(group: PlanGroup): boolean {
  return group.slots.some((slot) => slot.status === "pending");
}

/** 今日页上仍可用的入口（T5-a 裁定：tab 里没有录入位，「核心动作 ≤2 屏」靠这里兜住，常驻不可移）。 */
const ENTRIES = [
  {
    href: "/intake/rx" as const,
    title: "拍处方笺入药箱",
    desc: "一张处方笺 → 建档 + 服药计划一次完成",
    icon: FileText,
  },
  {
    href: "/intake/drug" as const,
    title: "拍药盒入药箱",
    desc: "拍一张药盒正面 → 识别 → 你核对 → 进药箱",
    icon: Camera,
  },
];

const SOON = [
  { title: "AI 用药咨询", when: "M5-T7" },
  { title: "退到后台的系统级到点提醒", when: "M5-T8" },
];

/**
 * 今日页（M5-T5b：照 web `routes/patient/Home.tsx` 的逻辑真相，渲染层重写）。
 * 任务数据 = GET /api/tasks/today，30s 轮询；到点未处理项进 core 的提醒队列，队首自动弹窗；
 * 打勾写 POST /api/records 走乐观更新（失败回滚 + 页内可见错误）。
 * 提醒只在**本页打开期间**发生——队列在客户端内存里，系统通知属 M5-T8（05d §7 第 4 条）。
 */
export default function Today() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const today = todayStr();
  const configured = isApiConfigured();
  const primary = useUnstableNativeVariable("--primary");
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const [pending, setPending] = useState<PendingRecord | null>(null);
  const [reminderPlanId, setReminderPlanId] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const { queue, enqueue, dequeue } = useReminderQueue();

  const { data, isPending, error, refetch, isRefetching } = useQuery({
    queryKey: ["tasks", "today"],
    queryFn: fetchTodayTasks,
    refetchInterval: 30_000,
    enabled: configured,
  });
  const groups = useMemo(() => groupTasksByPlan(data?.items ?? []), [data]);

  // 记录服药：乐观改 today 缓存 → 失败回滚（unwrap 已经 ApiNotifier 弹 toast，页内再落一条可见错误）。
  const recordMutation = useMutation({
    mutationFn: async (input: { planId: string; time: string; status: RecordStatus }) => {
      const res = await client.api.records.$post({
        json: { planId: input.planId, date: today, time: input.time, status: input.status },
      });
      return unwrap(res);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["tasks", "today"] });
      const prev = queryClient.getQueryData<TodayData>(["tasks", "today"]);
      queryClient.setQueryData<TodayData>(["tasks", "today"], (old) =>
        old
          ? {
              ...old,
              items: old.items.map((it) =>
                it.planId === input.planId && it.time === input.time
                  ? { ...it, status: input.status }
                  : it,
              ),
            }
          : old,
      );
      return { prev };
    },
    onSuccess: () => setRecordError(null),
    onError: (err, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["tasks", "today"], ctx.prev);
      setRecordError(err instanceof Error ? err.message : "记录没能写入，请重试");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", "today"] });
      queryClient.invalidateQueries({ queryKey: ["drugs"] });
    },
  });

  // 轮询比对：到点仍 pending 的计划入队（同计划不重复入队）。
  // 依赖**不能**带 queue：关掉一个会 dequeue → queue 变 → effect 重跑 → 该计划仍到点 pending
  // 且已不在队列 → 立刻被重新入队，弹窗永远关不完（10-02 真机实测连点 6 次 ✕ 仍在弹）。
  // 与 web `routes/patient/Home.tsx:93-99` 同语义：只跟 groups。队列读当前值走 getState()，不吃闭包旧值。
  useEffect(() => {
    const queued = useReminderQueue.getState().queue;
    for (const group of groups) {
      const due = duePendingSlots(group);
      if (due.length > 0 && !queued.some((item) => item.planId === group.planId)) {
        enqueue({ planId: group.planId, time: due[0].time });
      }
    }
  }, [groups, enqueue]);
  // 队首自动弹出。队首计划若已无可操作时点（今日全部记录/跳过），丢掉这一项再看下一个——
  // 死弹窗（三个钮全灰、只能按 ✕）不该出现，用户口径 10-03：「完成了就不该弹出来」。
  useEffect(() => {
    if (reminderPlanId || queue.length === 0) return;
    const head = queue[0];
    const group = groups.find((item) => item.planId === head.planId);
    if (!group) return;
    if (!hasPendingSlot(group)) {
      dequeue();
      return;
    }
    setReminderPlanId(head.planId);
  }, [groups, queue, reminderPlanId, dequeue]);

  const reminderGroup = groups.find((group) => group.planId === reminderPlanId) ?? null;
  const summary = data?.summary;
  const progress = summary?.progress ?? 0;

  function requestRecord(group: PlanGroup, time: string, status: RecordStatus) {
    setPending({ planId: group.planId, time, status, drugName: group.drugName });
  }
  function confirmRecord(record: PendingRecord) {
    recordMutation.mutate({ planId: record.planId, time: record.time, status: record.status });
    setPending(null);
    setReminderPlanId(null);
    dequeue();
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingBottom: TAB_BAR_BOTTOM_PAD,
        paddingTop: 16,
      }}
      refreshControl={
        configured ? (
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={mutedForeground}
          />
        ) : undefined
      }
    >
      <Text className="text-xs font-bold uppercase tracking-[2px] text-primary">今日</Text>
      <Text className="mt-1 text-2xl font-bold text-foreground">安心用药</Text>
      <Text className="mt-1 text-base leading-6 text-muted-foreground">
        把一个人的药放进同一个药箱：先能拍照建档，再管依从、冲突与效期。
      </Text>

      <View
        className={`mt-5 rounded-2xl border p-4 ${
          configured ? "border-border bg-card" : "border-risk-l4 bg-risk-l4-tint"
        }`}
      >
        <Text className="text-sm text-muted-foreground">服务器地址</Text>
        <Text className={`mt-1 text-base ${configured ? "text-card-foreground" : "text-risk-l4"}`}>
          {configured ? apiBaseUrl() : API_URL_MISSING_HINT}
        </Text>
      </View>

      {!configured ? null : isPending ? (
        <Text className="mt-6 text-base text-muted-foreground">正在读取今日任务…</Text>
      ) : error ? (
        <View className="mt-6 rounded-2xl border border-risk-l4 bg-risk-l4-tint p-5">
          <Text className="text-lg font-semibold text-risk-l4">今日任务读取失败</Text>
          <Text className="mt-1 text-sm leading-5 text-risk-l4">
            {error instanceof Error ? error.message : "请求没能完成"}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void refetch()}
            className="mt-4 min-h-[48px] items-center justify-center rounded-xl bg-primary active:opacity-80"
          >
            <Text className="text-lg font-medium text-primary-foreground">重试</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* hero 进度 */}
          <View className="mt-6 flex-row items-center justify-between gap-4 rounded-2xl bg-primary p-5">
            <View className="flex-1">
              <Text className="text-xs text-primary-foreground opacity-80">{todayLabel()}</Text>
              <Text className="mt-1 text-2xl font-bold text-primary-foreground">
                {!summary || summary.total === 0
                  ? "把所有来源的药放进同一个药箱"
                  : progress >= 100
                    ? "今天的用药已全部记录"
                    : "按时用药，安心每一天"}
              </Text>
              <Text className="mt-1 text-sm text-primary-foreground opacity-80">
                所有提醒均来自你亲自确认的计划。
              </Text>
            </View>
            <View className="size-[92px] items-center justify-center rounded-full bg-primary-foreground">
              <Text className="text-2xl font-bold text-primary">{progress}%</Text>
              <Text className="text-xs text-primary opacity-80">今日完成</Text>
            </View>
          </View>

          {recordError ? (
            <View className="mt-4 rounded-2xl border border-risk-l4 bg-risk-l4-tint p-4">
              <Text className="text-base font-semibold text-risk-l4">记录未写入</Text>
              <Text className="mt-1 text-sm leading-5 text-risk-l4">{recordError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setRecordError(null)}
                className="mt-3 min-h-[44px] items-center justify-center rounded-xl border border-risk-l4 active:opacity-80"
              >
                <Text className="text-base font-medium text-risk-l4">知道了</Text>
              </Pressable>
            </View>
          ) : null}

          {groups.length === 0 ? (
            <View className="mt-4 items-center rounded-2xl border border-dashed border-border p-8">
              <Icon as={PackageCheck} size={40} color={primary} />
              <Text className="mt-3 text-xl font-bold text-foreground">
                还没有今日用药任务
              </Text>
              <Text className="mt-1 text-center text-sm leading-5 text-muted-foreground">
                完成录入并建立计划后，这里会出现每日服药任务。
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/intake/rx")}
                className="mt-5 min-h-[48px] items-center justify-center rounded-xl bg-primary px-6 active:opacity-80"
              >
                <Text className="text-lg font-medium text-primary-foreground">开始录入</Text>
              </Pressable>
            </View>
          ) : (
            <View className="mt-4 gap-3">
              {groups.map((group) => (
                <View key={group.planId} className="rounded-2xl border border-border bg-card p-4">
                  <View className="flex-row items-start gap-3">
                    <View className="size-12 shrink-0 items-center justify-center rounded-xl bg-secondary">
                      <Icon as={Pill} size={24} color={primary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="flex-1 text-lg font-bold text-card-foreground">
                          {group.drugName}
                        </Text>
                        <View className="shrink-0 rounded-full bg-secondary px-2 py-0.5">
                          <Text className="text-xs font-semibold text-secondary-foreground">
                            {cycleLabel(group)}
                          </Text>
                        </View>
                      </View>
                      <Text className="mt-1 text-sm text-muted-foreground">
                        {group.specification ?? ""} · 每次 {group.dose.value} {group.dose.unit} ·
                        每日 {group.frequency} 次
                        {group.route ? ` · ${group.route}` : ""}
                      </Text>
                    </View>
                  </View>

                  <View className="mt-3 flex-row flex-wrap gap-2">
                    {group.slots.map((slot) => (
                      <TaskSlotChip
                        key={slot.time}
                        slot={slot}
                        onPress={() => requestRecord(group, slot.time, "taken")}
                      />
                    ))}
                  </View>

                  {hasPendingSlot(group) ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setReminderPlanId(group.planId)}
                      className="mt-3 min-h-[48px] flex-row items-center justify-center gap-2 rounded-xl border border-border bg-card active:opacity-80"
                    >
                      <Icon as={Bell} size={18} color={mutedForeground} />
                      <Text className="text-base font-medium text-card-foreground">处理提醒</Text>
                    </Pressable>
                  ) : (
                    // 全部记录后这里不再是按钮：点开一个全灰的弹窗等于给用户一个坏掉的入口
                    // （web 现状如此，H5 已冻结兜底不再演进，此差异登记在 §2.7 差异清单）。
                    <View className="mt-3 min-h-[48px] flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-border">
                      <Icon as={Check} size={18} color={mutedForeground} />
                      <Text className="text-base text-muted-foreground">今日已全部记录</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </>
      )}

      <View className="mt-8 gap-3">
        {ENTRIES.map((entry) => (
          <Pressable
            key={entry.title}
            accessibilityRole="button"
            onPress={() => router.push(entry.href)}
            className="min-h-[76px] flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 active:opacity-80"
          >
            <Icon as={entry.icon} size={26} color={mutedForeground} />
            <View className="flex-1">
              <Text className="text-xl font-semibold text-card-foreground">{entry.title}</Text>
              <Text className="text-sm text-muted-foreground">{entry.desc}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      <Text className="mt-8 text-lg font-semibold text-foreground">还在路上</Text>
      <View className="mt-2 gap-2">
        {SOON.map((item) => (
          <View
            key={item.title}
            className="flex-row items-center justify-between rounded-xl border border-dashed border-border px-4 py-3"
          >
            <Text className="flex-1 text-base text-muted-foreground">{item.title}</Text>
            <Text className="ml-3 text-xs text-muted-foreground">{item.when}</Text>
          </View>
        ))}
      </View>

      <View className="mt-6 rounded-xl border border-border bg-card p-3">
        <Text className="text-xs leading-5 text-muted-foreground">
          应用内提醒说明：仅在本页打开期间到点提醒，退到后台或关闭后不会发送系统通知（系统通知随
          M5-T8 接入）。漏服不会自动建议补服。
        </Text>
      </View>

      {reminderGroup ? (
        <ReminderModal
          group={reminderGroup}
          open={reminderPlanId !== null}
          onClose={() => {
            setReminderPlanId(null);
            dequeue();
          }}
          onRequest={(time, status) => requestRecord(reminderGroup, time, status)}
        />
      ) : null}
      <ConfirmRecordDialog
        pending={pending}
        busy={recordMutation.isPending}
        onClose={() => setPending(null)}
        onConfirm={confirmRecord}
      />
    </ScrollView>
  );
}
