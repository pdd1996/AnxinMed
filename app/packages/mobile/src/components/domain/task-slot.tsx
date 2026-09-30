import { Check, Clock3, Pause } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { Pressable } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import type { TaskSlot, TaskStatus } from "@anxin/core";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * 任务状态文案与图标（web 在 Home.tsx:24-35 与 ReminderModal.tsx:13-25 各抄了一份，
 * RN 侧两屏必须同形，故合成一处）。
 */
export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "待服用",
  taken: "已服",
  skipped: "已跳过",
  later: "稍后提醒",
};

export const STATUS_ICON: Record<TaskStatus, LucideIcon> = {
  pending: Clock3,
  taken: Check,
  skipped: Pause,
  later: Clock3,
};

/**
 * 时间点胶囊（05d §6 第 1 条触控 ≥44px、第 4 条不单靠颜色）：
 * 可点与已完成除配色外还差「2px 实线描边 + 加粗 + 状态文案 + 图标」四件，深色下同样成立。
 * ⚠️ 禁写 `bg-primary/10` 一类的「令牌色/透明度」修饰符——mobile 的 tailwind 令牌是
 * `var(--primary)` 纯字符串（无 `<alpha-value>` 占位），带修饰符的类在编译期整条不落进产物
 * （09-30 tailwind CLI 实测），只会得到「样式静默失效」。图标不是 Text，也拿不到
 * TextClassContext，颜色只能显式读 CSS 变量（同 (patient)/_layout.tsx 的口径）。
 */
export function TaskSlotChip({
  slot,
  onPress,
}: {
  slot: TaskSlot;
  onPress: () => void;
}) {
  const pending = slot.status === "pending";
  const primary = useUnstableNativeVariable("--primary");
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        pending ? `记录 ${slot.time} 为已服` : `${slot.time} ${STATUS_LABEL[slot.status]}`
      }
      disabled={!pending}
      onPress={onPress}
      className={cn(
        "min-h-[44px] flex-row items-center gap-1.5 rounded-full px-3",
        pending
          ? "border-2 border-primary bg-card active:opacity-80"
          : "border border-border bg-muted",
      )}
    >
      <Icon as={STATUS_ICON[slot.status]} size={18} color={pending ? primary : mutedForeground} />
      <Text
        className={cn(
          "text-base font-bold",
          pending ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {slot.time}
      </Text>
      <Text className="text-sm text-muted-foreground">{STATUS_LABEL[slot.status]}</Text>
    </Pressable>
  );
}
