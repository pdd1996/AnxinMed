import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUnstableNativeVariable } from "nativewind";
import { Check, ChevronRight, Trash2, UserRound } from "lucide-react-native";
import { client, fetchProfile, unwrap } from "@anxin/core";
import { HEALTH_FIELDS, ageFromBirthMonth, formatBirthMonth, type HealthField } from "@anxin/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type ProfileDto = Awaited<ReturnType<typeof fetchProfile>>;
type HealthEntry = ProfileDto["items"][number];

/** 字段级示例文案（照 web `profile/HealthInfoCard.tsx:23-29`，老年向：给一格就填一格，不猜格式）。 */
const FIELD_PLACEHOLDER: Partial<Record<HealthField, string>> = {
  过敏史: "如：青霉素",
  诊断: "如：高血压、2型糖尿病（你报告的诊断）",
  特殊状态: "如：孕期、安装心脏起搏器",
  紧急联系人: "如：李四 13800000000",
  年龄: "如：68",
};

const pad2 = (value: string) => value.padStart(2, "0");

/**
 * 健康信息卡（M5-T5e，照 web `profile/HealthInfoCard.tsx`）：HEALTH_FIELDS 七字段常驻——
 * 已填显示值 + 来源标注，未填显示「待补充 ›」点行即填；编辑/补充共用一个弹窗，
 * 删除走弹窗内二次确认（行上一键即删已移除，防误触）。
 * 写入一律 `PATCH /api/profile`，来源标注由服务端定（手动保存 = self_reported，见 profiles.service:32）。
 *
 * 「年龄」与「出生年月」联动（2026-11-19，照 web）：填了出生年月即按周岁自动算年龄，年龄行改只读展示
 * 「按出生年月自动计算」，避免同一件事填两遍；未填出生年月时才允许手填年龄（只知年龄的老人）。
 *
 * `showHeader=false` 用于「健康信息」一级页：页头已给出标题与说明，卡内不再重复标题行。
 *
 * 两处平台适配（语义不变，见 T5-真机验收.md §2.9 差异清单）：
 * ① 出生年月不用任何日期弹层：web 用「4 位年份输入 + 12 个月份大按钮」，RN 用「年 / 月」两个 number-pad
 * 框拼回 `YYYY-MM`（两端都不走浏览器/系统日期选择器，只差「月份点按钮」还是「月份打字」）；
 * ② web 的行 hover 底色在 RN 换成 `active:opacity-80`。
 */
export function HealthInfoCard({ showHeader = true }: { showHeader?: boolean }) {
  const queryClient = useQueryClient();
  const primary = useUnstableNativeVariable("--primary");
  const primaryForeground = useUnstableNativeVariable("--primary-foreground");
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  // 红字走 --risk-l4 而不是 --destructive：后者的深色档是 #7f1d1d，压在深色卡面上约 2:1，读不出（05d §6 第 16 条）。
  const riskL4 = useUnstableNativeVariable("--risk-l4");
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["profile"],
    queryFn: fetchProfile,
  });
  const entries = data?.items ?? [];

  // 服务端按 fieldKey upsert（理论唯一）；防御性取首条。
  const byField = useMemo(() => {
    const map = new Map<string, HealthEntry>();
    for (const entry of entries) {
      if (!map.has(entry.fieldKey)) map.set(entry.fieldKey, entry);
    }
    return map;
  }, [entries]);

  // 出生年月 → 周岁联动：有出生年月时，年龄由它算出来（改出生年月后自动更新，不用重填）。
  const birthEntry = byField.get("出生年月") ?? null;
  const derivedAge = ageFromBirthMonth(birthEntry?.value ?? "");
  // 列表与「修改出生年月」说明里的展示形态（1958-06 → 1958年6月，与 web 同口径）；脏数据回退原值。
  const birthDisplay = birthEntry
    ? (formatBirthMonth(birthEntry.value ?? "") ?? birthEntry.value ?? "")
    : "";

  const [editing, setEditing] = useState<{ field: HealthField; entry: HealthEntry | null } | null>(
    null,
  );
  const [value, setValue] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showingDerivedAge, setShowingDerivedAge] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const patch = useMutation({
    mutationFn: async (payload: {
      upserts?: { fieldKey: string; value: string }[];
      deletes?: string[];
    }) => {
      const res = await client.api.profile.$patch({ json: payload });
      return unwrap(res);
    },
    onError: (cause) =>
      setFailure(cause instanceof Error ? cause.message : "保存没能完成，请重试"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });

  const isBirth = editing?.field === "出生年月";
  const birthCandidate =
    /^\d{4}$/.test(birthYear) && /^(0?[1-9]|1[0-2])$/.test(birthMonth)
      ? `${birthYear}-${pad2(birthMonth)}`
      : "";
  // 形态合法还不够：未来月份算不出周岁，同样判不通过（否则年龄联动失效、且落无意义数据）。
  const birthAge = birthCandidate ? ageFromBirthMonth(birthCandidate) : null;
  const birthValid = birthCandidate !== "" && birthAge !== null;
  const draft = isBirth ? (birthValid ? birthCandidate : "") : value.trim();

  function openEditor(field: HealthField, entry: HealthEntry | null) {
    setEditing({ field, entry });
    setFailure(null);
    setConfirmingDelete(false);
    setShowingDerivedAge(false);
    const current = entry?.value ?? "";
    if (field === "出生年月") {
      const [year = "", month = ""] = current.split("-");
      setBirthYear(year);
      setBirthMonth(String(Number(month) || ""));
      setValue("");
    } else {
      setValue(current);
      setBirthYear("");
      setBirthMonth("");
    }
  }
  function closeEditor() {
    setEditing(null);
    setConfirmingDelete(false);
    setShowingDerivedAge(false);
    setFailure(null);
    setValue("");
  }
  function handleSave() {
    if (!editing || !draft) return;
    const upserts = [{ fieldKey: editing.field, value: draft }];
    // 保存出生年月时把算出的年龄一并写库：换端/换页读到的年龄与出生年月一致（同为用户自述派生）。
    if (editing.field === "出生年月" && birthAge !== null) {
      upserts.push({ fieldKey: "年龄", value: String(birthAge) });
    }
    patch.mutate({ upserts }, { onSuccess: closeEditor });
  }
  function handleDelete() {
    if (!editing) return;
    patch.mutate({ deletes: [editing.field] }, { onSuccess: closeEditor });
  }

  return (
    <Card className="gap-0 p-0">
      {showHeader ? (
        <CardHeader className="border-b border-border">
          <View className="flex-row items-center gap-2">
            <Icon as={UserRound} size={20} color={primary} />
            <CardTitle className="flex-1 text-base">健康信息</CardTitle>
            <Text className="text-xs text-muted-foreground">点按行可补充或修改</Text>
          </View>
        </CardHeader>
      ) : null}

      <CardContent className="p-0">
        {isPending ? (
          <Text className="px-4 py-6 text-base text-muted-foreground">正在读取健康信息…</Text>
        ) : error ? (
          <View className="gap-3 px-4 py-5">
            <Text className="text-base font-semibold text-risk-l4">健康信息读取失败</Text>
            <Text className="text-sm leading-5 text-risk-l4">
              {error instanceof Error ? error.message : "请求没能完成"}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void refetch()}
              className="min-h-[48px] items-center justify-center rounded-xl bg-primary active:opacity-80"
            >
              <Text className="text-lg font-medium text-primary-foreground">重试</Text>
            </Pressable>
          </View>
        ) : (
          HEALTH_FIELDS.map((field, index) => {
            const entry = byField.get(field) ?? null;
            const isAge = field === "年龄";
            // 有出生年月时年龄只读展示派生值（出生年月是唯一真相），没填时才允许手填。
            const derived = isAge && derivedAge !== null ? derivedAge : null;
            // 出生年月按「1958年6月」展示（存储仍是 1958-06，与 web `displayValueOf` 同口径）；脏数据回退原值。
            const rawValue = entry?.value ?? "";
            const displayValue =
              derived !== null
                ? String(derived)
                : field === "出生年月"
                  ? (formatBirthMonth(rawValue) ?? rawValue)
                  : rawValue;
            const filled = Boolean(displayValue.trim());
            const confirmed =
              derived === null && entry?.sourceMeta?.source === "prescription_confirmed";
            return (
              <Pressable
                key={field}
                accessibilityRole="button"
                onPress={() => {
                  if (derived !== null) {
                    setEditing(null);
                    setShowingDerivedAge(true);
                  } else {
                    openEditor(field, entry);
                  }
                }}
                className={`min-h-[64px] flex-row items-center gap-3 px-4 py-3 active:opacity-80 ${
                  index === HEALTH_FIELDS.length - 1 ? "" : "border-b border-border"
                }`}
              >
                <Text className="shrink-0 text-base font-semibold text-foreground">{field}</Text>
                {filled ? (
                  <View className="min-w-0 flex-1 items-end">
                    <Text
                      className="text-right text-sm font-medium text-card-foreground"
                      numberOfLines={2}
                    >
                      {displayValue}
                    </Text>
                    <Text
                      className={cn(
                        "mt-0.5 text-right text-xs",
                        confirmed ? "font-medium text-primary" : "text-muted-foreground",
                      )}
                    >
                      {derived !== null
                        ? "按出生年月自动计算"
                        : confirmed
                          ? "处方笺抄录 · 已确认"
                          : "用户自述"}
                    </Text>
                  </View>
                ) : (
                  <Text className="flex-1 text-right text-sm text-muted-foreground">待补充</Text>
                )}
                <Icon as={ChevronRight} size={18} color={mutedForeground} />
              </Pressable>
            );
          })
        )}
      </CardContent>

      <Dialog
        open={editing !== null || showingDerivedAge}
        onOpenChange={(next) => !next && closeEditor()}
      >
        <DialogContent className="max-h-[88vh]">
          {editing && confirmingDelete ? (
            <>
              <DialogHeader>
                <DialogTitle>删除「{editing.field}」</DialogTitle>
                <DialogDescription>
                  <Text className="text-base text-muted-foreground">
                    确定删除这条健康信息？删除后如需恢复要重新填写。
                  </Text>
                </DialogDescription>
              </DialogHeader>
              {failure ? <FailureLine message={failure} /> : null}
              <DialogFooter className="flex-row">
                <Button
                  variant="outline"
                  className="min-h-[48px] flex-1"
                  disabled={patch.isPending}
                  onPress={() => setConfirmingDelete(false)}
                >
                  <Text>取消</Text>
                </Button>
                <Button
                  variant="destructive"
                  className="min-h-[48px] flex-1"
                  disabled={patch.isPending}
                  onPress={handleDelete}
                >
                  <Text>{patch.isPending ? "删除中…" : "确认删除"}</Text>
                </Button>
              </DialogFooter>
            </>
          ) : editing ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {editing.entry ? "编辑" : "补充"}「{editing.field}」
                </DialogTitle>
              </DialogHeader>

              {editing.field === "性别" ? (
                <View className="flex-row gap-3">
                  {(["男", "女"] as const).map((option) => {
                    const selected = value === option;
                    return (
                      <Pressable
                        key={option}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => setValue(option)}
                        className={cn(
                          "min-h-[52px] flex-1 flex-row items-center justify-center gap-2 rounded-xl border-2",
                          selected ? "border-primary bg-secondary" : "border-input bg-background",
                        )}
                      >
                        <View
                          className={cn(
                            "size-6 items-center justify-center rounded-full border-2",
                            selected ? "border-primary bg-primary" : "border-input",
                          )}
                        >
                          {selected ? (
                            <Icon as={Check} size={14} color={primaryForeground} />
                          ) : null}
                        </View>
                        <Text className="text-base font-semibold text-foreground">{option}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : isBirth ? (
                <View className="flex-row items-center gap-2">
                  <Input
                    className="min-h-[52px] w-28 text-center"
                    value={birthYear}
                    keyboardType="number-pad"
                    maxLength={4}
                    onChangeText={setBirthYear}
                    placeholder="1958"
                    accessibilityLabel="出生年份"
                  />
                  <Text className="text-base text-muted-foreground">年</Text>
                  <Input
                    className="min-h-[52px] w-20 text-center"
                    value={birthMonth}
                    keyboardType="number-pad"
                    maxLength={2}
                    onChangeText={setBirthMonth}
                    placeholder="5"
                    accessibilityLabel="出生月份"
                  />
                  <Text className="text-base text-muted-foreground">月</Text>
                </View>
              ) : (
                <Input
                  className="min-h-[52px]"
                  value={value}
                  onChangeText={setValue}
                  keyboardType={editing.field === "年龄" ? "number-pad" : "default"}
                  maxLength={editing.field === "年龄" ? 3 : 60}
                  placeholder={FIELD_PLACEHOLDER[editing.field]}
                  accessibilityLabel={`${editing.field}（内容）`}
                />
              )}

              {isBirth && (birthYear.length > 0 || birthMonth.length > 0) && !birthValid ? (
                <Text className="text-xs text-risk-l4">
                  {birthCandidate
                    ? "出生年月不能晚于当前月份，否则算不出年龄。"
                    : "填 4 位年份与 1–12 的月份，例如 1958 年 5 月。"}
                </Text>
              ) : null}
              {failure ? <FailureLine message={failure} /> : null}

              <DialogFooter className="flex-row items-center justify-between">
                {editing.entry ? (
                  <Button
                    variant="ghost"
                    className="min-h-[48px] flex-row items-center gap-1.5"
                    onPress={() => {
                      setFailure(null);
                      setConfirmingDelete(true);
                    }}
                  >
                    <Icon as={Trash2} size={18} color={riskL4} />
                    <Text className="text-risk-l4">删除</Text>
                  </Button>
                ) : null}
                <View className="flex-1 flex-row justify-end gap-2">
                  <Button
                    variant="outline"
                    className="min-h-[48px] px-5"
                    disabled={patch.isPending}
                    onPress={closeEditor}
                  >
                    <Text>取消</Text>
                  </Button>
                  <Button
                    className="min-h-[48px] px-5"
                    disabled={draft.length === 0 || patch.isPending}
                    onPress={handleSave}
                  >
                    <Text>{patch.isPending ? "保存中…" : "保存"}</Text>
                  </Button>
                </View>
              </DialogFooter>
            </>
          ) : showingDerivedAge && derivedAge !== null ? (
            <>
              <DialogHeader>
                <DialogTitle>年龄</DialogTitle>
                <DialogDescription>
                  <Text className="text-base text-muted-foreground">
                    「出生年月 {birthDisplay}」自动算出 {derivedAge} 岁。改年龄请直接改出生年月，两项会同步。
                  </Text>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-row justify-end gap-2">
                <Button variant="outline" className="min-h-[48px] px-5" onPress={closeEditor}>
                  <Text>取消</Text>
                </Button>
                <Button
                  className="min-h-[48px] px-5"
                  onPress={() => openEditor("出生年月", birthEntry)}
                >
                  <Text>修改出生年月</Text>
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FailureLine({ message }: { message: string }) {
  return (
    <View className="rounded-xl border border-risk-l4 bg-risk-l4-tint p-3">
      <Text className="text-sm leading-5 text-risk-l4">{message}</Text>
    </View>
  );
}
