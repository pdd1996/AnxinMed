import {
  CircleCheck,
  Info,
  LockKeyhole,
  OctagonX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { View } from "react-native";
import type { RiskEventLevel, RiskLevel } from "@anxin/shared";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type RiskKind = RiskLevel | RiskEventLevel;

/**
 * 类名必须是**源码里的字面量**（NativeWind 靠扫源码收类名），所以每档把三条类写全，
 * 不拼 `text-risk-${level}` 这种动态串。色值走 global.css 的双档令牌，改一处深浅都跟着变。
 */
const RISK_META: Record<
  RiskKind,
  {
    label: string;
    hint: string;
    icon: LucideIcon;
    cssVar: string;
    shell: string;
    text: string;
  }
> = {
  L1: {
    label: "低风险",
    hint: "可参考说明书",
    icon: CircleCheck,
    cssVar: "--risk-l1",
    shell: "border-risk-l1 bg-risk-l1-tint",
    text: "text-risk-l1",
  },
  L2: {
    label: "提示",
    hint: "建议咨询药师",
    icon: Info,
    cssVar: "--risk-l2",
    shell: "border-risk-l2 bg-risk-l2-tint",
    text: "text-risk-l2",
  },
  L3: {
    label: "注意",
    hint: "建议咨询医生",
    icon: TriangleAlert,
    cssVar: "--risk-l3",
    shell: "border-risk-l3 bg-risk-l3-tint",
    text: "text-risk-l3",
  },
  L4: {
    label: "高危",
    hint: "请立即就医",
    icon: OctagonX,
    cssVar: "--risk-l4",
    shell: "border-risk-l4 bg-risk-l4-tint",
    text: "text-risk-l4",
  },
  "manual-gate": {
    label: "人工档",
    hint: "未经 OCR 确认",
    icon: LockKeyhole,
    cssVar: "--muted-foreground",
    shell: "border-muted-foreground bg-muted",
    text: "text-muted-foreground",
  },
};

/**
 * 风险语义徽章（照 web `domain/RiskBadge.tsx`，色 + 图标 + 文字三件套，§6 第 4 条）。
 * 与 web 的两处差异：① web 的 `bg-risk-lN/10|/15` 浅底在这里换成算好的实色 `*-tint` 令牌、
 * `border-risk-lN/30` 换成实色 + 2px 描边（带 alpha 的类在 RN 侧整条不落进产物，见 README 与 05d §7-7）；
 * ② 图标不吃 TextClassContext，颜色显式读同一支 CSS 变量，保证深浅色下与文字同色。
 */
export function RiskBadge({
  level,
  showHint = true,
  className,
}: {
  level: RiskKind;
  showHint?: boolean;
  className?: string;
}) {
  const meta = RISK_META[level];
  const color = useUnstableNativeVariable(meta.cssVar);

  return (
    <View
      accessibilityLabel={`${meta.label}，${meta.hint}`}
      className={cn(
        "min-h-[36px] flex-row items-center gap-1.5 self-start rounded-full border-2 px-3",
        meta.shell,
        className,
      )}
    >
      <Icon as={meta.icon} size={18} color={color} />
      <Text className={cn("text-base font-semibold", meta.text)}>{meta.label}</Text>
      {showHint ? (
        <Text className={cn("text-sm opacity-80", meta.text)}>{meta.hint}</Text>
      ) : null}
    </View>
  );
}
