import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUnstableNativeVariable } from "nativewind";
import { Check, ChevronRight, Info, Trash2, UserRound } from "lucide-react-native";
import { client, fetchProfile, unwrap } from "@anxin/core";
import { HEALTH_FIELDS, type HealthField } from "@anxin/shared";
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
 * 两处平台适配（语义不变，见 T5-真机验收.md §2.9 差异清单）：
 * ① web 的 `<input type="month">` → 「年 / 月」两个 number-pad 框，拼回 `YYYY-MM`；
 * ② web 的行 hover 底色在 RN 换成 `active:opacity-80`。
 */
export function HealthInfoCard() {
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

  const [editing, setEditing] = useState<{ field: HealthField; entry: HealthEntry | null } | null>(
    null,
  );
  const [value, setValue] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
  const birthValid = /^\d{4}$/.test(birthYear) && /^(0?[1-9]|1[0-2])$/.test(birthMonth);
  const draft = isBirth ? (birthValid ? `${birthYear}-${pad2(birthMonth)}` : "") : value.trim();

  function openEditor(field: HealthField, entry: HealthEntry | null) {
    setEditing({ field, entry });
    setFailure(null);
    setConfirmingDelete(false);
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
    setFailure(null);
    setValue("");
  }
  function handleSave() {
    if (!editing || !draft) return;
    patch.mutate({ upserts: [{ fieldKey: editing.field, value: draft }] }, { onSuccess: closeEditor });
  }
  function handleDelete() {
    if (!editing) return;
    patch.mutate({ deletes: [editing.field] }, { onSuccess: closeEditor });
  }

  return (
    <Card className="gap-0 p-0">
      <CardHeader className="border-b border-border">
        <View className="flex-row items-center gap-2">
          <Icon as={UserRound} size={20} color={primary} />
          <CardTitle className="flex-1 text-base">健康信息</CardTitle>
          <Text className="text-xs text-muted-foreground">点按行可补充或修改</Text>
        </View>
      </CardHeader>

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
            const filled = Boolean(entry && entry.value?.trim());
            const confirmed = entry?.sourceMeta?.source === "prescription_confirmed";
            return (
              <Pressable
                key={field}
                accessibilityRole="button"
                onPress={() => openEditor(field, entry)}
                className={`min-h-[64px] flex-row items-center justify-between gap-3 px-4 py-3 active:opacity-80 ${
                  index === HEALTH_FIELDS.length - 1 ? "" : "border-b border-border"
                }`}
              >
                <Text className="text-base font-semibold text-foreground">{field}</Text>
                {filled ? (
                  <View className="flex-1 items-end">
                    <Text
                      className="text-right text-sm font-medium text-card-foreground"
                      numberOfLines={2}
                    >
                      {entry?.value ?? ""}
                    </Text>
                    <Text
                      className={cn(
                        "mt-0.5 text-right text-xs",
                        confirmed ? "font-medium text-primary" : "text-muted-foreground",
                      )}
                    >
                      {confirmed ? "处方笺抄录 · 已确认" : "用户自述"}
                    </Text>
                  </View>
                ) : (
                  <View className="flex-row items-center gap-0.5">
                    <Text className="text-sm text-muted-foreground">待补充</Text>
                    <Icon as={ChevronRight} size={16} color={mutedForeground} />
                  </View>
                )}
              </Pressable>
            );
          })
        )}

        <View className="flex-row items-start gap-2 border-t border-border px-4 py-3">
          <Icon as={Info} size={16} color={mutedForeground} />
          <Text className="flex-1 text-xs leading-5 text-muted-foreground">
            产品不做诊断：「诊断」字段语义永远为「用户报告的诊断」，AI 将其视为用户提供的、未经医学验证的信息。
          </Text>
        </View>
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(next) => !next && closeEditor()}>
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
                <DialogDescription>
                  <Text className="text-base text-muted-foreground">
                    保存后将标注为「用户自述」，AI 仅将其视为你提供的、未经医学验证的参考。
                  </Text>
                </DialogDescription>
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
                <Text className="text-xs text-risk-l4">填 4 位年份与 1–12 的月份，例如 1958 年 5 月。</Text>
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
