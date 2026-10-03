import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Check, Plus, X } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { addDaysStr, DOSE_UNITS, estimateStockDays, suggestTimes, todayStr, type CycleType } from "@anxin/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export interface PlanFormResult {
  dose: { value: number; unit: string };
  frequency: number;
  times: string[];
  meal: string;
  cycleType: CycleType;
  endDate?: string;
}

export interface PlanFormInitial {
  dose: { value: number; unit: string };
  frequency: number;
  times: string[];
  meal?: string | null;
  cycleType: CycleType;
}

const MEALS = ["无特殊要求", "饭前", "饭后", "随餐", "睡前"];

const CYCLES: { value: CycleType; title: string; desc: string }[] = [
  { value: "open", title: "长期服用", desc: "开放式 · 无结束日期" },
  { value: "stock", title: "用完为止", desc: "按库存推算可用天数" },
  { value: "closed", title: "自定义天数", desc: "封闭式 · 推算结束日期" },
];

/** 时间点合法性：HH:MM，24 小时制，与 web `type="time"` 的取值域一致。 */
function isHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function joinPart(head: string, tail: string): string {
  return `${head.padStart(2, "0")}:${tail.padStart(2, "0")}`;
}

/**
 * 「时 / 分」两框的可编辑原文。
 * ⚠️ 框的 `value` 必须是**用户敲出来的原文**，不能是补零后的规范串：受控值一补零回写，
 * 框里恒为两位，`maxLength={2}` 就把后续按键整条吃掉（"08"+"2"="082" 超长 → 连
 * onChangeText 都不触发），而退格删成一位又立刻被补回两位 —— 结果是四框全敲不进数字
 * （10-03 用户真机反馈「编辑时间没法输入数字」）。规范 `HH:MM` 只在保存/校验时拼。
 */
interface TimeParts {
  hour: string;
  minute: string;
}

function splitTime(time: string): TimeParts {
  const [hour = "", minute = ""] = time.split(":");
  return { hour, minute };
}

/** 单框是否填全且落在取值域内（空框、超 23 时 / 59 分都算非法）。 */
function isTimePartsValid({ hour, minute }: TimeParts): boolean {
  return (
    /^\d{1,2}$/.test(hour) && /^\d{1,2}$/.test(minute) && isHHMM(joinPart(hour, minute))
  );
}

/**
 * 手动建 / 编辑服药计划（M5-T5c，照 web `domain/PlanModal.tsx` 的字段与判定，渲染层换 RN）。
 * 医嘱只抄录不生成：用量/频次/时间点全部由用户填写，`suggestTimes` 给的初值标「辅助」。
 * 归算口径不在这里：`closed` 的结束日期用 shared 的 `addDaysStr`（与服务端同源公式），
 * `stock` 的预计可用天数用 shared 的 `estimateStockDays` 只做**预览**，落库时服务端自己算
 * （`api/src/services/plans.service.ts:140-147`）；四类标注 tags 全在服务端定，客户端不传。
 *
 * 两处平台适配（不是语义改动，见 T5-真机验收.md 差异清单）：
 * ① web 的 `<select>` 在 RN 没有对应控件，单位/服药要求改成 chip 单选行（老年向也更少误点）；
 * ② web 的 `type="time"` 改成「时 / 分」两个 number-pad 框（§6 第 10 条：不出现自由文本敲时间）。
 */
export function PlanModal({
  open,
  drugName,
  drugSpec,
  defaultUnit,
  stock,
  initial,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  drugName: string;
  drugSpec?: string | null;
  defaultUnit?: string;
  /** 该药已填库存（`stock` 档的可用天数预览）；缺库存时预览会明说不算数。 */
  stock?: { value: number; unit: string } | null;
  initial?: PlanFormInitial;
  busy: boolean;
  onClose: () => void;
  onSave: (data: PlanFormResult) => void;
}) {
  const primary = useUnstableNativeVariable("--primary");
  const primaryForeground = useUnstableNativeVariable("--primary-foreground");
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const [doseValue, setDoseValue] = useState(String(initial?.dose.value ?? 1));
  const [doseUnit, setDoseUnit] = useState(initial?.dose.unit ?? defaultUnit ?? "片");
  const [frequency, setFrequency] = useState(String(initial?.frequency ?? 3));
  const [times, setTimes] = useState<TimeParts[]>(() =>
    (initial?.times ?? suggestTimes(3)).map(splitTime),
  );
  const [meal, setMeal] = useState(initial?.meal ?? MEALS[0]);
  const [cycle, setCycle] = useState<CycleType>(initial?.cycleType ?? "open");
  const [customDays, setCustomDays] = useState("7");
  const [agreed, setAgreed] = useState(false);

  // 频次变化重算建议时间点（标「辅助」，可改）；编辑已有计划时不覆盖用户已定的时点。
  useEffect(() => {
    if (!initial) setTimes(suggestTimes(Number(frequency) || 1).map(splitTime));
  }, [frequency, initial]);

  const timesValid = times.length > 0 && times.every(isTimePartsValid);
  const valid =
    Number(doseValue) > 0 &&
    Number(frequency) > 0 &&
    timesValid &&
    agreed &&
    (cycle !== "closed" || Number(customDays) > 0);

  /** 「用完为止」的预计可用天数（与服务端同一函数，仅作预览；库存未填 → 0）。 */
  const stockPreview =
    cycle === "stock"
      ? estimateStockDays(stock?.value ?? 0, Number(doseValue) || 0, Number(frequency) || 0)
      : 0;

  function setTimePart(index: number, part: "hour" | "minute", value: string) {
    setTimes((current) =>
      current.map((time, i) => (i === index ? { ...time, [part]: value } : time)),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh]">
        <DialogHeader>
          <DialogTitle className="text-xl">{initial ? "编辑服药计划" : "创建服药计划"}</DialogTitle>
          <DialogDescription>
            <Text className="text-base text-muted-foreground">
              请严格按照医生处方、说明书或药师指导填写——系统不会替你生成用量。当前药品：{drugName}
              {drugSpec ? ` · ${drugSpec}` : ""}
            </Text>
          </DialogDescription>
        </DialogHeader>

        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
          <View className="gap-4">
            <View className="flex-row gap-3">
              <View className="flex-1 gap-1">
                <Label className="text-base">每次用量</Label>
                <Input
                  className="min-h-[48px]"
                  value={doseValue}
                  keyboardType="number-pad"
                  maxLength={4}
                  onChangeText={setDoseValue}
                  accessibilityLabel="每次用量数值"
                />
              </View>
              <View className="flex-1 gap-1">
                <Label className="text-base">频次（每日次数）</Label>
                <Input
                  className="min-h-[48px]"
                  value={frequency}
                  keyboardType="number-pad"
                  maxLength={1}
                  onChangeText={setFrequency}
                  accessibilityLabel="每日次数"
                />
              </View>
            </View>

            <View className="gap-1">
              <Label className="text-base">用量单位</Label>
              <View className="flex-row flex-wrap gap-2">
                {DOSE_UNITS.map((unit) => (
                  <OptionChip
                    key={unit}
                    label={unit}
                    selected={doseUnit === unit}
                    onPress={() => setDoseUnit(unit)}
                  />
                ))}
              </View>
            </View>

            <View className="gap-1">
              <Label className="text-base">服药要求</Label>
              <View className="flex-row flex-wrap gap-2">
                {MEALS.map((item) => (
                  <OptionChip
                    key={item}
                    label={item}
                    selected={meal === item}
                    onPress={() => setMeal(item)}
                  />
                ))}
              </View>
            </View>

            <View className="gap-2">
              <View className="flex-row items-center gap-2">
                <Label className="text-base">服药时间点（建议可改）</Label>
                <View className="rounded-full bg-secondary px-2 py-0.5">
                  <Text className="text-xs font-semibold text-secondary-foreground">辅助</Text>
                </View>
              </View>
              {times.map((time, index) => {
                const bad = !isTimePartsValid(time);
                return (
                  <View key={index} className="flex-row items-center gap-2">
                    <Input
                      className="min-h-[48px] w-16 text-center"
                      value={time.hour}
                      keyboardType="number-pad"
                      maxLength={2}
                      onChangeText={(value) => setTimePart(index, "hour", value)}
                      accessibilityLabel={`时间点 ${index + 1} 小时`}
                    />
                    <Text className="text-xl font-bold text-foreground">:</Text>
                    <Input
                      className="min-h-[48px] w-16 text-center"
                      value={time.minute}
                      keyboardType="number-pad"
                      maxLength={2}
                      onChangeText={(value) => setTimePart(index, "minute", value)}
                      accessibilityLabel={`时间点 ${index + 1} 分钟`}
                    />
                    {bad ? (
                      <Text className="flex-1 text-xs text-risk-l4">按 24 小时制填 0–23 时 / 0–59 分</Text>
                    ) : (
                      <View className="flex-1" />
                    )}
                    <Button
                      variant="ghost"
                      className="min-h-[44px] px-3"
                      accessibilityLabel="删除该时间点"
                      onPress={() => setTimes((current) => current.filter((_, i) => i !== index))}
                    >
                      <Icon as={X} size={20} color={mutedForeground} />
                    </Button>
                  </View>
                );
              })}
              <Button
                variant="outline"
                className="min-h-[48px] flex-row items-center justify-center gap-2"
                onPress={() => setTimes((current) => [...current, splitTime("08:00")])}
              >
                <Icon as={Plus} size={18} color={primary} />
                <Text>添加时间点</Text>
              </Button>
            </View>

            <View className="gap-2">
              <Label className="text-base">周期形态</Label>
              {CYCLES.map((item) => (
                <Pressable
                  key={item.value}
                  accessibilityRole="button"
                  onPress={() => setCycle(item.value)}
                  className={cn(
                    "min-h-[52px] flex-row items-center justify-between rounded-xl px-3 py-2",
                    cycle === item.value
                      ? "border-2 border-primary bg-secondary"
                      : "border border-input bg-background",
                  )}
                >
                  <Text className="text-base font-semibold text-foreground">{item.title}</Text>
                  <Text className="text-xs text-muted-foreground">{item.desc}</Text>
                </Pressable>
              ))}
              {cycle === "closed" ? (
                <View className="flex-row items-center gap-2">
                  <Input
                    className="min-h-[48px] w-24 text-center"
                    value={customDays}
                    keyboardType="number-pad"
                    maxLength={3}
                    onChangeText={setCustomDays}
                    accessibilityLabel="疗程天数"
                  />
                  <Text className="flex-1 text-sm text-muted-foreground">
                    天（结束日期自动推算至 {addDaysStr(todayStr(), Number(customDays) || 0)}）
                  </Text>
                </View>
              ) : null}
              {cycle === "stock" ? (
                <Text className="text-sm text-muted-foreground">
                  {stockPreview > 0
                    ? `按库存 ${stock?.value ?? 0} ${stock?.unit ?? ""}，约可用 ${stockPreview} 天（推算，落库时服务端按同一公式复核）`
                    : "这支药还没填库存，暂时算不出可用天数——建好计划后可在药箱补录库存。"}
                </Text>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              onPress={() => setAgreed((prev) => !prev)}
              className="min-h-[52px] flex-row items-center gap-3"
            >
              <View
                className={cn(
                  "size-8 items-center justify-center rounded-lg border-2",
                  agreed ? "border-primary bg-primary" : "border-input bg-background",
                )}
              >
                {agreed ? <Icon as={Check} size={20} color={primaryForeground} /> : null}
              </View>
              <Text className="flex-1 text-base text-foreground">
                此用量来自处方、说明书或药师指导
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        <Button
          className="min-h-[52px] w-full"
          disabled={!valid || busy}
          onPress={() =>
            onSave({
              dose: { value: Number(doseValue), unit: doseUnit },
              frequency: Number(frequency),
              // 交给服务端的仍是规范 `HH:MM`，与 web `type="time"` 的提交值同形。
              times: times.map((t) => joinPart(t.hour, t.minute)),
              meal,
              cycleType: cycle,
              endDate: cycle === "closed" ? addDaysStr(todayStr(), Number(customDays)) : undefined,
            })
          }
        >
          <Text>{busy ? "提交中…" : initial ? "保存计划" : "确认创建计划"}</Text>
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** chip 单选：选中态除配色外还多 2px 描边（§6 第 4 条不单靠颜色）。 */
function OptionChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        "min-h-[44px] items-center justify-center rounded-full px-3",
        selected ? "border-2 border-primary bg-secondary" : "border border-input bg-background",
      )}
    >
      <Text
        className={cn(
          "text-base",
          selected ? "font-bold text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
