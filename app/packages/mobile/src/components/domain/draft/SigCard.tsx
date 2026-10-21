import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Clock3, ListChecks, Plus, X } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { DOSE_UNITS, suggestTimes, type TagKind } from "@anxin/shared";
import {
  CONFIRM_MEALS,
  hasTranscribed,
  resolveCycle,
  sigNeedsManual,
  stockDays,
  type ConfirmFormState,
  type CycleChoice,
  type DraftPayload,
} from "@anxin/core";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { isTimePartsValid, joinPart, splitTime, type TimeParts } from "@/lib/time";
import { cn } from "@/lib/utils";
import { TagBadge } from "./TagBadge";

/**
 * 医嘱核对卡 + 服药时间点卡（T6-d，对齐 web `domain/draft/SigCard.tsx`）。
 * 用量 / 频次 / 疗程无差别逐项核对，抄录值必须勾「已核对」才放行（core 的 unmetReasons 兜底）；
 * needsManual / sigMissing 覆盖项初值恒为空，绝不预填（PRD §7.2.6）。
 *
 * 三处平台适配（与 web 刻意不同，已登记 05e §2-T6-d）：
 * ① web 的 `<select>` 改 chip 行；② `type="date"` 改年 / 月 / 日三个数字框；
 * ③ `type="time"` 改「时 / 分」两框（范式同 PlanModal，规范串只在合法后拼）。
 */

const CYCLES: { value: CycleChoice; title: string; desc: (days: number) => string }[] = [
  { value: "longterm", title: "长期服用", desc: () => "开放式 · 无结束日期，持续提醒直到暂停/结束" },
  {
    value: "until-used",
    title: "用完为止",
    desc: (days) =>
      days > 0 ? `按库存推算约 ${days} 天（推算）` : "按库存推算 · 库存未知，确认后可在药箱补录",
  },
  { value: "custom", title: "自定义天数", desc: () => "封闭式 · 结束日期自动推算" },
];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 三个数字框 → ISO 日期；不完整 / 不存在的日期返回空串（空串会被 core 闸门拦住）。 */
function composeDate(year: string, month: string, day: string): string {
  if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) return "";
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return "";
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 核对行外壳：标签 + 标注 + 「已核对」勾选框（抄录值必须逐项勾，PRD §7.2.5）。 */
function VerifyRow({
  label,
  tag,
  checked,
  onCheck,
  hint,
  last,
  children,
}: {
  label: string;
  tag?: TagKind | null;
  checked?: boolean;
  onCheck?: () => void;
  hint?: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <View className={cn("gap-2 py-3", last ? "" : "border-b border-border")}>
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-base font-bold text-foreground">{label}</Text>
        <TagBadge kind={tag} />
        {onCheck ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: Boolean(checked) }}
            accessibilityLabel={`已核对${label}`}
            onPress={onCheck}
            className="ml-auto min-h-[44px] flex-row items-center gap-2"
          >
            <View
              className={cn(
                "size-6 items-center justify-center rounded border-2",
                checked ? "border-primary bg-primary" : "border-border bg-background",
              )}
            >
              {checked ? <Text className="text-sm font-bold text-primary-foreground">✓</Text> : null}
            </View>
            <Text className="text-base font-semibold text-foreground">已核对</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
      {hint ? <Text className="text-xs leading-5 text-risk-l3">{hint}</Text> : null}
    </View>
  );
}

function UnitChips({ value, onPress }: { value: string; onPress: (unit: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View className="flex-row gap-2">
        {value
          ? [value, ...(DOSE_UNITS as readonly string[]).filter((u) => u !== value)].map((unit) => {
              const active = unit === value;
              return (
                <Pressable
                  key={unit}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`用量单位 ${unit}`}
                  onPress={() => onPress(unit)}
                  className={cn(
                    "min-h-[44px] items-center justify-center rounded-xl border-2 px-4",
                    active ? "border-primary bg-primary" : "border-border bg-background",
                  )}
                >
                  <Text
                    className={cn(
                      "text-base font-semibold",
                      active ? "text-primary-foreground" : "text-foreground",
                    )}
                  >
                    {unit}
                  </Text>
                </Pressable>
              );
            })
          : null}
      </View>
    </ScrollView>
  );
}

/** 开始日期：年 / 月 / 日三个数字框，拼成 ISO 串交给 core（web 用原生 date 控件）。 */
function DateField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [year, setYear] = useState(() => value.slice(0, 4));
  const [month, setMonth] = useState(() => value.slice(5, 7));
  const [day, setDay] = useState(() => value.slice(8, 10));
  const complete = Boolean(composeDate(year, month, day));

  function apply(nextYear: string, nextMonth: string, nextDay: string) {
    setYear(nextYear);
    setMonth(nextMonth);
    setDay(nextDay);
    onChange(composeDate(nextYear, nextMonth, nextDay));
  }

  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        <Input
          className="min-h-[48px] w-20 text-center"
          value={year}
          keyboardType="number-pad"
          maxLength={4}
          onChangeText={(next) => apply(next, month, day)}
          accessibilityLabel="开始日期 年"
        />
        <Text className="text-base text-foreground">年</Text>
        <Input
          className="min-h-[48px] w-12 text-center"
          value={month}
          keyboardType="number-pad"
          maxLength={2}
          onChangeText={(next) => apply(year, next, day)}
          accessibilityLabel="开始日期 月"
        />
        <Text className="text-base text-foreground">月</Text>
        <Input
          className="min-h-[48px] w-12 text-center"
          value={day}
          keyboardType="number-pad"
          maxLength={2}
          onChangeText={(next) => apply(year, month, next)}
          accessibilityLabel="开始日期 日"
        />
        <Text className="text-base text-foreground">日</Text>
      </View>
      {complete ? null : (
        <Text className="text-xs leading-5 text-risk-l4">
          请填写完整的年 / 月 / 日（如 2026 / 10 / 21），否则无法确认
        </Text>
      )}
    </View>
  );
}

export function SigCard({
  payload,
  state,
  patch,
}: {
  payload: DraftPayload;
  state: ConfirmFormState;
  patch: (partial: Partial<ConfirmFormState>) => void;
}) {
  const primary = useUnstableNativeVariable("--primary");
  const plan = payload.planDraft;
  if (!plan) return null;

  const doseTranscribed = hasTranscribed(payload, "dose");
  const freqTranscribed = hasTranscribed(payload, "frequency");
  const durationTranscribed = hasTranscribed(payload, "duration");
  const doseManual = sigNeedsManual(payload, "dose");
  const freqManual = sigNeedsManual(payload, "frequency");
  const dateMissing = (payload.needsManual ?? []).includes("date");
  const days = stockDays(payload, state);
  const { endDate } = resolveCycle(payload, state);

  return (
    <Card>
      <CardHeader>
        <View className="flex-row flex-wrap items-center gap-2">
          <Icon as={ListChecks} size={20} color={primary} />
          <CardTitle className="text-lg text-card-foreground">医嘱核对</CardTitle>
          <Text className="text-xs text-muted-foreground">只抄录不生成 · 三项关键字段逐项核对</Text>
        </View>
      </CardHeader>
      <CardContent>
        <VerifyRow
          label="每次用量"
          tag={
            doseTranscribed &&
            Number(state.doseValue) === (plan.dose?.value ?? NaN) &&
            state.doseUnit === plan.dose?.unit
              ? "transcribed"
              : "user"
          }
          checked={state.checked.dose}
          onCheck={
            doseTranscribed
              ? () => patch({ checked: { ...state.checked, dose: !state.checked.dose } })
              : undefined
          }
          hint={
            doseManual
              ? `规则未从原文抽出用量 —— 请对照原文人工补，系统不预填猜测。原文该行：${payload.item?.usage || "（该行缺失或被涂黑）"}`
              : undefined
          }
        >
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <Input
                className="min-h-[48px] w-32 text-center"
                value={state.doseValue}
                keyboardType="decimal-pad"
                placeholder={doseManual ? "人工补录" : "如 1"}
                placeholderTextColor="#9ca3af"
                onChangeText={(next) => patch({ doseValue: next })}
                accessibilityLabel="每次用量"
              />
              <Text className="text-base text-foreground">{state.doseUnit || "单位"}</Text>
            </View>
            <UnitChips
              value={state.doseUnit}
              onPress={(unit) => patch({ doseUnit: unit })}
            />
          </View>
        </VerifyRow>

        <VerifyRow
          label="频次"
          tag={freqTranscribed && Number(state.frequency) === plan.frequency ? "transcribed" : "user"}
          checked={state.checked.frequency}
          onCheck={
            freqTranscribed
              ? () => patch({ checked: { ...state.checked, frequency: !state.checked.frequency } })
              : undefined
          }
          hint={
            freqManual
              ? `规则未从原文抽出频次 —— 请对照原文人工补。原文该行：${payload.item?.usage || "（该行缺失或被涂黑）"}`
              : undefined
          }
        >
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <Input
                className="min-h-[48px] w-24 text-center"
                value={state.frequency}
                keyboardType="number-pad"
                maxLength={1}
                placeholder={freqManual ? "人工补录" : "如 3"}
                placeholderTextColor="#9ca3af"
                onChangeText={(next) => patch({ frequency: next })}
                accessibilityLabel="每日几次"
              />
              <Text className="text-base text-foreground">次 / 日</Text>
            </View>
            <Button
              variant="outline"
              className="min-h-[44px] flex-row items-center justify-center gap-2"
              disabled={!Number(state.frequency)}
              onPress={() => patch({ times: suggestTimes(Number(state.frequency)) })}
            >
              <Icon as={Clock3} size={18} color={primary} />
              <Text>按频次生成时间点建议</Text>
            </Button>
          </View>
        </VerifyRow>

        <VerifyRow
          label="途径"
          tag={plan.route && state.route === plan.route ? "transcribed" : state.route ? "user" : undefined}
        >
          <Input
            className="min-h-[48px]"
            value={state.route}
            placeholder="如：滴眼 / 口服（原文未抽出可留空）"
            placeholderTextColor="#9ca3af"
            onChangeText={(next) => patch({ route: next })}
            accessibilityLabel="用药途径"
          />
        </VerifyRow>

        <VerifyRow
          label="开始日期"
          tag={state.startDate === plan.startDate ? (plan.tags?.startDate ?? "default") : "user"}
          hint={
            dateMissing
              ? "处方日期在原文中缺失或被涂黑 —— 此处为系统默认值（今天），请核对后修改。"
              : undefined
          }
        >
          <DateField value={state.startDate} onChange={(next) => patch({ startDate: next })} />
        </VerifyRow>

        <VerifyRow
          label="疗程"
          tag={durationTranscribed && !state.cycleOverride ? "transcribed" : "user"}
          checked={state.checked.duration}
          onCheck={
            durationTranscribed && !state.cycleOverride
              ? () => patch({ checked: { ...state.checked, duration: !state.checked.duration } })
              : undefined
          }
          hint={
            durationTranscribed
              ? undefined
              : "原文没有疗程 —— 请三选一（长期服用 / 用完为止 / 自定义天数），系统不替你决定。"
          }
        >
          {durationTranscribed && !state.cycleOverride ? (
            <View className="gap-2">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-base font-bold text-foreground">
                  共 {plan.durationDays} 天 · 结束日期 {endDate || "—"}
                </Text>
                <TagBadge kind="derived" />
              </View>
              <Button
                variant="outline"
                className="min-h-[44px]"
                onPress={() => patch({ cycleOverride: true })}
              >
                <Text>与实物/医嘱不符 · 改用其他疗程形态</Text>
              </Button>
            </View>
          ) : (
            <View className="gap-2">
              {CYCLES.map((cycle) => {
                const active = state.cycle === cycle.value;
                return (
                  <Pressable
                    key={cycle.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`疗程 ${cycle.title}`}
                    onPress={() => patch({ cycle: cycle.value })}
                    className={cn(
                      "min-h-[52px] flex-row items-center justify-between gap-3 rounded-xl px-3 py-2",
                      active
                        ? "border-2 border-primary bg-secondary"
                        : "border border-input bg-background",
                    )}
                  >
                    <Text className="text-base font-semibold text-foreground">{cycle.title}</Text>
                    <Text className="shrink text-right text-xs text-muted-foreground">
                      {cycle.desc(days)}
                    </Text>
                  </Pressable>
                );
              })}
              {state.cycle === "custom" ? (
                <View className="flex-row items-center gap-2">
                  <Input
                    className="min-h-[48px] w-24 text-center"
                    value={state.customDays}
                    keyboardType="number-pad"
                    maxLength={3}
                    onChangeText={(next) => patch({ customDays: next })}
                    accessibilityLabel="疗程天数"
                  />
                  <Text className="flex-1 text-sm text-muted-foreground">
                    天（结束日期自动推算）
                  </Text>
                </View>
              ) : null}
              {state.cycleOverride ? (
                <Button
                  variant="ghost"
                  className="min-h-[44px] flex-row items-center justify-center gap-2"
                  onPress={() => patch({ cycleOverride: false })}
                >
                  <Icon as={X} size={16} color={primary} />
                  <Text className="text-muted-foreground">
                    恢复处方抄录疗程（共 {plan.durationDays} 天）
                  </Text>
                </Button>
              ) : null}
            </View>
          )}
        </VerifyRow>

        <VerifyRow label="服药要求" tag="default" last>
          <View className="flex-row flex-wrap gap-2">
            {CONFIRM_MEALS.map((meal) => {
              const active = state.meal === meal;
              return (
                <Pressable
                  key={meal}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`服药要求 ${meal}`}
                  onPress={() => patch({ meal })}
                  className={cn(
                    "min-h-[44px] items-center justify-center rounded-xl border-2 px-4",
                    active ? "border-primary bg-primary" : "border-border bg-background",
                  )}
                >
                  <Text
                    className={cn(
                      "text-base font-semibold",
                      active ? "text-primary-foreground" : "text-foreground",
                    )}
                  >
                    {meal}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </VerifyRow>
      </CardContent>
    </Card>
  );
}

/**
 * 服药时间点卡（PRD §7.3.3：系统建议永不冒充医嘱，标「辅助」且可改）。
 * 本地保留用户敲出的原文（`parts`），只把合法值拼成规范 `HH:MM` 交回表单；
 * 外部改动（如 SigCard 的「按频次生成建议」）通过 `lastEmitted` 识别后回填到本地原文。
 */
export function TimesCard({
  payload,
  state,
  patch,
}: {
  payload: DraftPayload;
  state: ConfirmFormState;
  patch: (partial: Partial<ConfirmFormState>) => void;
}) {
  const primary = useUnstableNativeVariable("--primary");
  const muted = useUnstableNativeVariable("--muted-foreground");
  const [parts, setParts] = useState<TimeParts[]>(() => state.times.map(splitTime));
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    const current = JSON.stringify(state.times);
    if (lastEmitted.current === current) return;
    lastEmitted.current = null;
    setParts(state.times.map(splitTime));
  }, [state.times]);

  if (!payload.planDraft) return null;

  function apply(next: TimeParts[]) {
    setParts(next);
    const times = next.map((part) =>
      isTimePartsValid(part) ? joinPart(part.hour, part.minute) : `${part.hour}:${part.minute}`,
    );
    lastEmitted.current = JSON.stringify(times);
    patch({ times });
  }

  function setPart(index: number, field: "hour" | "minute", value: string) {
    apply(parts.map((part, i) => (i === index ? { ...part, [field]: value } : part)));
  }

  const sameAsSuggested =
    JSON.stringify(state.times) === JSON.stringify(payload.planDraft.times ?? []);

  return (
    <Card>
      <CardHeader>
        <View className="flex-row flex-wrap items-center gap-2">
          <Icon as={Clock3} size={20} color={primary} />
          <CardTitle className="text-lg text-card-foreground">服药时间点</CardTitle>
          <TagBadge kind={sameAsSuggested ? "assist" : "user"} />
        </View>
      </CardHeader>
      <CardContent className="gap-2">
        {parts.length === 0 ? (
          <Text className="text-sm leading-5 text-muted-foreground">
            还没有时间点 —— 至少添加一个，或回到「频次」按建议生成。
          </Text>
        ) : null}
        {parts.map((part, index) => {
          const bad = !isTimePartsValid(part);
          return (
            <View key={index} className="flex-row items-center gap-2">
              <Input
                className="min-h-[48px] w-16 text-center"
                value={part.hour}
                keyboardType="number-pad"
                maxLength={2}
                onChangeText={(value) => setPart(index, "hour", value)}
                accessibilityLabel={`时间点 ${index + 1} 小时`}
              />
              <Text className="text-xl font-bold text-foreground">:</Text>
              <Input
                className="min-h-[48px] w-16 text-center"
                value={part.minute}
                keyboardType="number-pad"
                maxLength={2}
                onChangeText={(value) => setPart(index, "minute", value)}
                accessibilityLabel={`时间点 ${index + 1} 分钟`}
              />
              {bad ? (
                <Text className="flex-1 text-xs leading-5 text-risk-l4">
                  按 24 小时制填 0–23 时 / 0–59 分
                </Text>
              ) : (
                <View className="flex-1" />
              )}
              <Button
                variant="ghost"
                className="min-h-[44px] px-3"
                accessibilityLabel={`删除时间点 ${index + 1}`}
                onPress={() => apply(parts.filter((_, i) => i !== index))}
              >
                <Icon as={X} size={20} color={muted} />
              </Button>
            </View>
          );
        })}
        <Button
          variant="outline"
          className="min-h-[44px] flex-row items-center justify-center gap-2"
          onPress={() => apply([...parts, splitTime("08:00")])}
        >
          <Icon as={Plus} size={18} color={primary} />
          <Text>添加时间点</Text>
        </Button>
        <Text className="text-xs leading-5 text-muted-foreground">
          建议按频次在 8:00–22:00 均匀分布生成（每日 4 次 → 8/12/16/20），是辅助建议、不是医嘱，可自由调整。
        </Text>
      </CardContent>
    </Card>
  );
}
