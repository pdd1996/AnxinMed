import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useUnstableNativeVariable } from "nativewind";
import { AlertTriangle } from "lucide-react-native";

/**
 * 草稿确认页的卡片壳与「标签—值」行（M5-T6c）。
 * 对齐 web `components/ui/card.tsx` 的形态；RN 侧 `bg-card/border-border` 实色令牌可用，
 * 带 alpha 的 `bg-card/50` 一族禁写（令牌是纯 var 字符串，/alpha 整条不落产物，05d §7-7）。
 */
export function DraftCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View className="rounded-2xl border border-border bg-card p-4">
      <View className="flex-row flex-wrap items-center gap-2">
        {icon}
        <Text className="text-lg font-semibold text-card-foreground">{title}</Text>
        {subtitle ? <Text className="text-xs text-muted-foreground">{subtitle}</Text> : null}
      </View>
      <View className="mt-3 gap-2">{children}</View>
    </View>
  );
}

/** 一行对照（左标签、右值）；值缺省时显示占位，绝不编造（对齐 web 的 `<dl>` 行）。 */
export function DraftRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  /** 原文行用等宽呈现（web 侧是 `<code>`，长串要能折行扫读）。 */
  mono?: boolean;
}) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text
        className={`max-w-[62%] text-right text-sm font-semibold text-foreground ${
          mono ? "font-mono" : ""
        }`}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

/**
 * 告警/说明底（缺项清单、贴标提醒、背链拦截、三步扫描共用）。
 * 底色/描边走 risk-l3 实色令牌；正文用 --foreground——risk-l3 压 tint 上对比不够（同录入页既有口径）。
 */
export function WarnNote({
  children,
  small,
  icon,
}: {
  children: ReactNode;
  small?: boolean;
  icon?: ReactNode;
}) {
  const riskL3 = useUnstableNativeVariable("--risk-l3");
  return (
    <View className="flex-row items-start gap-2 rounded-xl border border-risk-l3 bg-risk-l3-tint p-3">
      {icon ?? (
        <AlertTriangle
          size={small ? 16 : 18}
          color={riskL3}
          importantForAccessibility="no"
          style={{ marginTop: 2 }}
        />
      )}
      <Text className={`flex-1 leading-5 text-foreground ${small ? "text-xs" : "text-sm"}`}>
        {children}
      </Text>
    </View>
  );
}