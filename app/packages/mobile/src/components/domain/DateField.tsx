import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";

/**
 * 年 / 月 / 日三个数字框的日期输入（T6-d 从 SigCard 抽出，供草稿确认页与建档 / 效期弹窗共用）。
 *
 * 平台适配（与 web 刻意不同，已登记 05e §2-T6-d）：web 用原生 `type="date"`，RN 没有对应控件，
 * 这里拆成三个 number-pad 框，只在三段都合法后拼成规范 `YYYY-MM-DD` 交回；不完整 / 不存在的
 * 日期返回空串（由上层决定按「未录入」处理还是被 core 闸门拦住）。
 *
 * ⚠️ 框的 `value` 必须是用户敲出来的**原文**，不能回写补零后的规范串：一补零回写，框里恒为
 * 两位，`maxLength={2}` 就把后续按键整条吃掉（同 `lib/time.ts` 的教训）。规范串只在 onChange
 * 里拼；外部重置（如弹窗重新打开时父级把值清空）靠 `lastEmitted` 识别后回填。
 */
export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 三个数字框 → ISO 日期；不完整 / 不存在的日期返回空串。 */
export function composeDate(year: string, month: string, day: string): string {
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

export function DateField({
  value,
  onChange,
  labelPrefix = "日期",
  optional = false,
}: {
  value: string;
  onChange: (next: string) => void;
  /** 无障碍标签前缀，如「有效期」→「有效期 年」；默认「日期」。 */
  labelPrefix?: string;
  /**
   * 可选日期（有效期 / 开封日期）：留空 = 未录入，不提示「无法确认」；
   * 只填了一部分时提示「填完整才生效」，避免半截输入被悄悄当成留空。
   * 默认为必填语义（SigCard 的开始日期，保持抽离前文案与行为不变）。
   */
  optional?: boolean;
}) {
  const [year, setYear] = useState(() => value.slice(0, 4));
  const [month, setMonth] = useState(() => value.slice(5, 7));
  const [day, setDay] = useState(() => value.slice(8, 10));
  /** 最近一次由本组件发出的值：用于区分「自己编辑触发的父级回写」与「外部重置」。 */
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    // 外部重置（如父级把表单清空）：把原始输入回填成外部值；本地编辑中的中间态不会走到这里
    setYear(value.slice(0, 4));
    setMonth(value.slice(5, 7));
    setDay(value.slice(8, 10));
    lastEmitted.current = value;
  }, [value]);

  const complete = Boolean(composeDate(year, month, day));
  const partiallyFilled = !complete && Boolean(year || month || day);
  // 必填项沿用抽离前的提示（含「否则无法确认」）；可选项只在半截输入时提醒，全空不打扰
  const showHint = optional ? partiallyFilled : !complete;

  function apply(nextYear: string, nextMonth: string, nextDay: string) {
    setYear(nextYear);
    setMonth(nextMonth);
    setDay(nextDay);
    const next = composeDate(nextYear, nextMonth, nextDay);
    lastEmitted.current = next;
    onChange(next);
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
          accessibilityLabel={`${labelPrefix} 年`}
        />
        <Text className="text-base text-foreground">年</Text>
        <Input
          className="min-h-[48px] w-12 text-center"
          value={month}
          keyboardType="number-pad"
          maxLength={2}
          onChangeText={(next) => apply(year, next, day)}
          accessibilityLabel={`${labelPrefix} 月`}
        />
        <Text className="text-base text-foreground">月</Text>
        <Input
          className="min-h-[48px] w-12 text-center"
          value={day}
          keyboardType="number-pad"
          maxLength={2}
          onChangeText={(next) => apply(year, month, next)}
          accessibilityLabel={`${labelPrefix} 日`}
        />
        <Text className="text-base text-foreground">日</Text>
      </View>
      {showHint ? (
        <Text
          className={
            optional ? "text-xs leading-5 text-risk-l3" : "text-xs leading-5 text-risk-l4"
          }
        >
          {optional
            ? "日期还没填完整：年 / 月 / 日三段都填对才会保存；留空表示未录入"
            : "请填写完整的年 / 月 / 日（如 2026 / 10 / 21），否则无法确认"}
        </Text>
      ) : null}
    </View>
  );
}
