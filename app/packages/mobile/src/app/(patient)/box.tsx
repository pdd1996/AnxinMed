import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View, type ColorValue } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUnstableNativeVariable } from "nativewind";
import {
  AlertTriangle,
  Camera,
  FileText,
  Hand,
  Pause,
  Pencil,
  Pill,
  Play,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react-native";
import { client, fetchDrugs, fetchPlans, unwrap } from "@anxin/core";
import { CONFIRM_STATUS_META, type CycleType, type PlanStatus } from "@anxin/shared";
import { DeleteDrugDialog } from "@/components/domain/DeleteDrugDialog";
import { ManualDrugModal, type ManualDrugForm } from "@/components/domain/ManualDrugModal";
import { PlanModal, type PlanFormResult } from "@/components/domain/PlanModal";
import { Icon } from "@/components/ui/icon";
import { TAB_BAR_BOTTOM_PAD } from "@/lib/layout";

type DrugItem = Awaited<ReturnType<typeof fetchDrugs>>[number];
type PlanItem = Awaited<ReturnType<typeof fetchPlans>>[number];

function planChip(plan?: PlanItem): string {
  if (!plan) return "未创建计划";
  if (plan.status === "paused") return "已暂停";
  if (plan.status === "ended") return "已结束";
  if (plan.cycleType === "open") return "生效中 · 开放式（长期）";
  if (plan.cycleType === "stock") return "生效中 · 用完为止";
  return `生效中 · 疗程至 ${plan.endDate ?? "—"}`;
}

/**
 * 开封超期提示（照 web `Box.tsx:25-28` 的 180 天经验值）。
 * 该值在 web 侧就写在渲染层，本片按「重写的是代码不是标准」原样搬，
 * 归位到 shared 属另一决定（见 T5-真机验收.md §3 差异清单）。
 */
function openedOverdue(drug: DrugItem): boolean {
  if (!drug.openedAt || !drug.expiry) return false;
  return new Date(drug.openedAt).getTime() + 180 * 86_400_000 < Date.now();
}

/**
 * 药箱页（M5-T5c，照 web `routes/patient/Box.tsx` 全量重写渲染层）。
 * 数据 = ['drugs'] + ['plans'] 两份查询；写操作四个 mutation 统一 invalidate
 * drugs/plans/tasks,today 三键（建计划会立刻改变今日任务）。
 * `md:` 断点的两列布局按 05 任务书 T5 第 3 条直接删成单列；
 * web 卡上的「问这个药」不放（咨询 UI 属 M5-T7，不做假按钮）。
 */
export default function Box() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const primary = useUnstableNativeVariable("--primary");
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const riskL4 = useUnstableNativeVariable("--risk-l4");
  const [showManual, setShowManual] = useState(false);
  const [planTarget, setPlanTarget] = useState<{ drug: DrugItem; plan?: PlanItem } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DrugItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const drugsQuery = useQuery({ queryKey: ["drugs"], queryFn: fetchDrugs });
  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: fetchPlans });
  const drugs = drugsQuery.data ?? [];
  const plans = plansQuery.data ?? [];
  const loading = drugsQuery.isPending || plansQuery.isPending;
  const loadError = drugsQuery.error ?? plansQuery.error;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["drugs"] });
    queryClient.invalidateQueries({ queryKey: ["plans"] });
    queryClient.invalidateQueries({ queryKey: ["tasks", "today"] });
  };

  /**
   * 四个写操作共见的守卫：失败除了 core 的 toast，还要落一条页内红条——
   * 建计划 / 删药都在 Dialog 里提交，toast 与 Portal 的层级未实测（T5-b §2.6 风险 1）。
   */
  const visibleFailure = {
    onMutate: () => setActionError(null),
    onError: (error: unknown) =>
      setActionError(error instanceof Error ? error.message : "操作没能完成，请重试"),
  };

  const createDrug = useMutation({
    mutationFn: async (form: ManualDrugForm) => {
      const res = await client.api.drugs.$post({ json: toDrugPayload(form) });
      return unwrap(res);
    },
    ...visibleFailure,
    onSuccess: () => {
      setShowManual(false);
      invalidate();
    },
  });

  const savePlan = useMutation({
    mutationFn: async (input: { drugId: string; planId?: string; data: PlanFormResult }) => {
      const { drugId, planId, data } = input;
      if (planId) {
        const res = await client.api.plans[":id"].$patch({
          param: { id: planId },
          json: {
            dose: data.dose,
            frequency: data.frequency,
            times: data.times,
            meal: data.meal,
            cycleType: data.cycleType,
            endDate: data.endDate ?? null,
          },
        });
        return unwrap(res);
      }
      const res = await client.api.plans.$post({
        json: {
          drugId,
          dose: data.dose,
          frequency: data.frequency,
          times: data.times,
          meal: data.meal,
          cycleType: data.cycleType,
          endDate: data.endDate ?? null,
        },
      });
      return unwrap(res);
    },
    ...visibleFailure,
    onSuccess: () => {
      setPlanTarget(null);
      invalidate();
    },
  });

  const patchStatus = useMutation({
    mutationFn: async (input: { planId: string; status: PlanStatus }) => {
      const res = await client.api.plans[":id"].$patch({
        param: { id: input.planId },
        json: { status: input.status },
      });
      return unwrap(res);
    },
    ...visibleFailure,
    onSuccess: invalidate,
  });

  const deleteDrug = useMutation({
    mutationFn: async (drugId: string) => {
      const res = await client.api.drugs[":id"].$delete({ param: { id: drugId } });
      return unwrap(res);
    },
    ...visibleFailure,
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
    },
  });

  const busy =
    createDrug.isPending || savePlan.isPending || patchStatus.isPending || deleteDrug.isPending;

  async function reload() {
    await Promise.all([drugsQuery.refetch(), plansQuery.refetch()]);
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
        <RefreshControl
          refreshing={drugsQuery.isRefetching || plansQuery.isRefetching}
          onRefresh={() => void reload()}
          tintColor={mutedForeground}
        />
      }
    >
      <Text className="text-xs font-bold uppercase tracking-[2px] text-primary">我的药箱</Text>
      <Text className="mt-1 text-2xl font-bold text-foreground">所有来源的药，同一个药箱</Text>

      <View className="mt-4 flex-row gap-3">
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => setShowManual(true)}
          className={`min-h-[52px] flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-card active:opacity-80 ${
            busy ? "opacity-50" : ""
          }`}
        >
          <Icon as={Hand} size={20} color={mutedForeground} />
          <Text className="text-lg font-medium text-card-foreground">手动建档</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => router.push("/intake")}
          className={`min-h-[52px] flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-primary active:opacity-80 ${
            busy ? "opacity-50" : ""
          }`}
        >
          <Icon as={Camera} size={20} color={primary} />
          <Text className="text-lg font-medium text-primary-foreground">拍照录入</Text>
        </Pressable>
      </View>

      {loading ? (
        <Text className="mt-6 text-base text-muted-foreground">正在读取药箱…</Text>
      ) : loadError ? (
        <View className="mt-6 rounded-2xl border border-risk-l4 bg-risk-l4-tint p-5">
          <Text className="text-lg font-semibold text-risk-l4">药箱读取失败</Text>
          <Text className="mt-1 text-sm leading-5 text-risk-l4">
            {loadError instanceof Error ? loadError.message : "请求没能完成"}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void reload()}
            className="mt-4 min-h-[48px] items-center justify-center rounded-xl bg-primary active:opacity-80"
          >
            <Text className="text-lg font-medium text-primary-foreground">重试</Text>
          </Pressable>
        </View>
      ) : (
        <View className="mt-5 gap-3">
          {actionError ? (
            <View className="rounded-2xl border border-risk-l4 bg-risk-l4-tint p-4">
              <Text className="text-base font-semibold text-risk-l4">操作没有完成</Text>
              <Text className="mt-1 text-sm leading-5 text-risk-l4">{actionError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setActionError(null)}
                className="mt-3 min-h-[44px] items-center justify-center rounded-xl border border-risk-l4 active:opacity-80"
              >
                <Text className="text-base font-medium text-risk-l4">知道了</Text>
              </Pressable>
            </View>
          ) : null}

          {drugs.length === 0 ? (
            <View className="items-center rounded-2xl border border-dashed border-border p-8">
              <Text className="text-xl font-bold text-foreground">药箱还是空的</Text>
              <Text className="mt-1 text-center text-sm leading-5 text-muted-foreground">
                拍一张药盒照片，识别并确认后加入药箱；也可手动建档。
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/intake")}
                className="mt-5 min-h-[48px] items-center justify-center rounded-xl bg-primary px-6 active:opacity-80"
              >
                <Text className="text-lg font-medium text-primary-foreground">去拍照</Text>
              </Pressable>
            </View>
          ) : (
            drugs.map((drug) => {
              const plan = plans.find((item) => item.drugId === drug.id);
              const meta = CONFIRM_STATUS_META[drug.confirmStatus];
              return (
                <View key={drug.id} className="rounded-2xl border border-border bg-card p-4">
                  <View className="flex-row items-start gap-3">
                    <View className="size-12 shrink-0 items-center justify-center rounded-xl bg-secondary">
                      <Icon as={Pill} size={24} color={primary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <View className="flex-row items-center gap-1.5">
                        <Icon as={ShieldCheck} size={14} color={mutedForeground} />
                        <Text className="text-xs font-semibold text-muted-foreground" accessibilityLabel={meta.hint}>
                          {meta.label}
                        </Text>
                      </View>
                      <Text className="mt-1 text-lg font-bold text-card-foreground">
                        {drug.genericName}
                      </Text>
                      <Text className="text-sm text-muted-foreground">{drug.brandName ?? ""}</Text>
                    </View>
                  </View>

                  <View className="mt-3 gap-1">
                    <Row label="规格" value={drug.specification ?? "—"} />
                    <Row
                      label="库存"
                      value={
                        drug.stock
                          ? `${drug.stock.value} ${drug.stock.unit}${
                              drug.estimatedStockDays && drug.estimatedStockDays > 0
                                ? `（约 ${drug.estimatedStockDays} 天）`
                                : ""
                            }`
                          : "—"
                      }
                    />
                    <Row label="有效期" value={drug.expiry ?? "待录入"} />
                    {drug.openedAt ? <Row label="开封" value={drug.openedAt} /> : null}
                  </View>

                  {openedOverdue(drug) ? (
                    <View className="mt-3 flex-row items-start gap-2 rounded-xl border border-risk-l4 bg-risk-l4-tint p-3">
                      <Icon as={AlertTriangle} size={18} color={riskL4} />
                      <Text className="flex-1 text-xs leading-5 text-risk-l4">
                        开封已超说明书效期，建议弃药（以说明书为准）。
                      </Text>
                    </View>
                  ) : null}

                  <View className="mt-3 flex-row flex-wrap items-center gap-2">
                    <View className="rounded-full bg-muted px-2 py-0.5">
                      <Text className="text-xs font-semibold text-muted-foreground">
                        {planChip(plan)}
                      </Text>
                    </View>
                    {plan?.tags?.dose ? (
                      <View className="rounded-full bg-secondary px-2 py-0.5">
                        <Text className="text-xs font-semibold text-secondary-foreground">
                          抄录/自填用量
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {plan ? (
                    <Text className="mt-1 text-sm text-muted-foreground">
                      每次 {plan.dose.value} {plan.dose.unit} · 每日 {plan.frequency} 次 ·{" "}
                      {plan.times.join(" / ")}
                    </Text>
                  ) : null}
                  {drug.sourceId ? (
                    <View className="mt-1 flex-row items-center gap-1.5">
                      <Icon as={FileText} size={14} color={mutedForeground} />
                      <Text className="text-xs text-muted-foreground">来源留痕已记录</Text>
                    </View>
                  ) : null}

                  <View className="mt-4 flex-row flex-wrap gap-2">
                    <CardAction
                      label={plan ? "编辑计划" : "创建计划"}
                      icon={Pencil}
                      tint={mutedForeground}
                      busy={busy}
                      onPress={() => setPlanTarget({ drug, plan })}
                    />
                    {plan && plan.status === "active" ? (
                      <CardAction
                        label="暂停"
                        icon={Pause}
                        tint={mutedForeground}
                        busy={busy}
                        onPress={() => patchStatus.mutate({ planId: plan.id, status: "paused" })}
                      />
                    ) : null}
                    {plan && plan.status === "paused" ? (
                      <CardAction
                        label="恢复"
                        icon={Play}
                        tint={mutedForeground}
                        busy={busy}
                        onPress={() => patchStatus.mutate({ planId: plan.id, status: "active" })}
                      />
                    ) : null}
                    {plan && plan.status !== "ended" ? (
                      <CardAction
                        label="结束"
                        icon={Square}
                        tint={mutedForeground}
                        busy={busy}
                        onPress={() => patchStatus.mutate({ planId: plan.id, status: "ended" })}
                      />
                    ) : null}
                    <CardAction
                      label="删除"
                      icon={Trash2}
                      tint={riskL4}
                      busy={busy}
                      onPress={() => setDeleteTarget(drug)}
                    />
                  </View>
                </View>
              );
            })
          )}

          {drugs.length > 0 ? (
            <Text className="text-xs text-muted-foreground">共 {drugs.length} 种药。</Text>
          ) : null}
        </View>
      )}

      <ManualDrugModal
        open={showManual}
        busy={createDrug.isPending}
        onClose={() => setShowManual(false)}
        onSave={(form) => createDrug.mutate(form)}
      />
      {planTarget ? (
        <PlanModal
          open
          drugName={planTarget.drug.genericName}
          drugSpec={planTarget.drug.specification}
          defaultUnit={planTarget.drug.stock?.unit}
          stock={planTarget.drug.stock}
          busy={savePlan.isPending}
          initial={
            planTarget.plan
              ? {
                  dose: planTarget.plan.dose,
                  frequency: planTarget.plan.frequency,
                  times: planTarget.plan.times,
                  meal: planTarget.plan.meal,
                  cycleType: planTarget.plan.cycleType as CycleType,
                }
              : undefined
          }
          onClose={() => setPlanTarget(null)}
          onSave={(data) =>
            savePlan.mutate({
              drugId: planTarget.drug.id,
              planId: planTarget.plan?.id,
              data,
            })
          }
        />
      ) : null}
      <DeleteDrugDialog
        drugName={deleteTarget?.genericName ?? null}
        busy={deleteDrug.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteDrug.mutate(deleteTarget.id)}
      />
    </ScrollView>
  );
}

/** POST /api/drugs 的请求体（手动建档路径；confirmStatus 由服务端固定 manual，客户端不传）。 */
function toDrugPayload(form: {
  genericName: string;
  specification: string;
  form: string;
  stock: number;
  stockUnit: string;
}) {
  return {
    genericName: form.genericName,
    specification: form.specification,
    form: form.form,
    stock: { value: form.stock, unit: form.stockUnit },
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-right text-sm font-semibold text-card-foreground">{value}</Text>
    </View>
  );
}

function CardAction({
  label,
  icon,
  tint,
  busy,
  onPress,
}: {
  label: string;
  icon: typeof Pencil;
  tint?: ColorValue;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      className={`min-h-[48px] flex-row items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 active:opacity-80 ${
        busy ? "opacity-50" : ""
      }`}
    >
      <Icon as={icon} size={18} color={tint} />
      <Text className="text-base font-medium text-card-foreground">{label}</Text>
    </Pressable>
  );
}
