import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, TriangleAlert } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import {
  EXPIRY_WARNING_DAYS,
  daysUntilExpiry,
  expiryState,
  todayStr,
} from "@anxin/shared";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * 30 天临期 / 已过期提醒（患者端）。
 *
 * 阈值与状态判定全部来自 shared：`EXPIRY_WARNING_DAYS = 30`、`expiryState` / `daysUntilExpiry`
 * —— 与咨询 S2、医生端同源一份真相，渲染层不再写死天数。
 * `null`（未录入/非法日期）既不是「临期」也不是「正常」：这里不提醒，但绝不计入 ok（不得误报「全部正常」）。
 * `today` 可选注入，便于测试跨日边界（第 30 天算临期、第 31 天不算）。
 *
 * 排版（2026-11-19 演示前收紧）：标题 + 分段计数两行；明细每条「药名一行 + 到期日/状态一行」，
 * 药名 numberOfLines=1、状态行原文不折行，窄屏不再出现半个词换行。
 */

export interface ExpiryDrug {
  id: string;
  genericName: string;
  /** YYYY-MM-DD；null/'' = 未录入。 */
  expiry?: string | null;
}

interface ExpiryEntry {
  drug: ExpiryDrug;
  /** 距到期天数（负 = 已过期，0 = 今天到期）。 */
  days: number;
}

/** 明细最多列几条，其余收成「等 N 种」。 */
const DETAIL_LIMIT = 6;

/** 按状态分桶：已过期 / 临期（0–30 天）；未录入与正常都不进桶。 */
function splitByExpiry(drugs: ExpiryDrug[], today: string) {
  const expired: ExpiryEntry[] = [];
  const expiring: ExpiryEntry[] = [];
  for (const drug of drugs) {
    const state = expiryState(drug.expiry, today);
    if (!state || state === "ok") continue;
    const days = daysUntilExpiry(drug.expiry, today);
    if (days === null) continue; // state 非 null 时 days 必非 null，这里只是类型收窄
    (state === "expired" ? expired : expiring).push({ drug, days });
  }
  // 已过期在前（过期最久的在前），临期按剩余天数由少到多
  expired.sort((a, b) => a.days - b.days);
  expiring.sort((a, b) => a.days - b.days);
  return { expired, expiring };
}

/** 明细第二行：到期日 + 状态（「已过期 5 天」不折行）。 */
function metaText(expiry: string | null | undefined, days: number): string {
  if (days < 0) return `${expiry} 到期 · 已过期 ${-days} 天`;
  if (days === 0) return `${expiry} 到期 · 今天到期`;
  return `${expiry} 到期 · 剩 ${days} 天`;
}

/** 计数摘要（标题下第二行）：已过期 / 临期各一段。 */
function ExpirySummary({ expiredCount, expiringCount }: { expiredCount: number; expiringCount: number }) {
  return (
    <View className="mt-0.5 flex-row flex-wrap items-center gap-x-2">
      {expiredCount > 0 ? (
        <Text className="text-xs font-semibold text-risk-l4">已过期 {expiredCount} 种</Text>
      ) : null}
      {expiredCount > 0 && expiringCount > 0 ? (
        <Text className="text-xs text-muted-foreground">·</Text>
      ) : null}
      {expiringCount > 0 ? (
        <Text className="text-xs font-semibold text-risk-l3">
          {EXPIRY_WARNING_DAYS} 天内到期 {expiringCount} 种
        </Text>
      ) : null}
    </View>
  );
}

/**
 * 药箱顶部效期汇总卡：两桶皆空（含全正常 / 全未录入）→ 返回 null，不占位。
 * 放在药箱页 header 与操作按钮之后（自带 mt-4 与下面的列表拉开距离）。
 */
export function ExpiryAlert({
  drugs,
  today = todayStr(),
}: {
  drugs: ExpiryDrug[];
  today?: string;
}) {
  const warn = useUnstableNativeVariable("--risk-l3");
  const { expired, expiring } = splitByExpiry(drugs, today);
  const total = expired.length + expiring.length;
  if (total === 0) return null;

  const entries = [...expired, ...expiring].slice(0, DETAIL_LIMIT);
  const overflow = total - entries.length;

  return (
    <View className="mt-4 rounded-2xl border-2 border-risk-l3 bg-risk-l3-tint p-4">
      <View className="flex-row items-center gap-2">
        <Icon as={TriangleAlert} size={20} color={warn} />
        <View className="min-w-0 flex-1">
          <Text className="text-base font-bold text-foreground">效期提醒</Text>
          <ExpirySummary expiredCount={expired.length} expiringCount={expiring.length} />
        </View>
      </View>

      <View className="mt-3 gap-2">
        {entries.map((entry) => (
          <View key={entry.drug.id} className="flex-row items-start gap-2">
            <View
              className={cn(
                "mt-1.5 size-1.5 rounded-full",
                entry.days < 0 ? "bg-risk-l4" : "bg-risk-l3",
              )}
            />
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                {entry.drug.genericName}
              </Text>
              <Text
                className={cn(
                  "text-xs font-semibold",
                  entry.days < 0 ? "text-risk-l4" : "text-risk-l3",
                )}
                numberOfLines={1}
              >
                {metaText(entry.drug.expiry, entry.days)}
              </Text>
            </View>
          </View>
        ))}
        {overflow > 0 ? (
          <Text className="text-xs leading-5 text-foreground">…等 {overflow} 种，去药箱逐条查看</Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * 今日页效期横幅：有临期/过期才渲染，点整条跳药箱。
 * 药箱数据拉取失败 → 调用方传空数组 → 不渲染（不阻塞今日主流程，也不误导成「没有临期」）。
 */
export function ExpiryBanner({
  drugs,
  today = todayStr(),
}: {
  drugs: ExpiryDrug[];
  today?: string;
}) {
  const router = useRouter();
  const warn = useUnstableNativeVariable("--risk-l3");
  const { expired, expiring } = splitByExpiry(drugs, today);
  const total = expired.length + expiring.length;
  if (total === 0) return null;

  const summaryLabel = [
    expired.length > 0 ? `已过期 ${expired.length} 种` : null,
    expiring.length > 0 ? `${EXPIRY_WARNING_DAYS} 天内到期 ${expiring.length} 种` : null,
  ]
    .filter(Boolean)
    .join("，");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`效期提醒：${summaryLabel}。去药箱`}
      onPress={() => router.push("/box")}
      className="mt-4 min-h-[48px] flex-row items-center gap-3 rounded-2xl border-2 border-risk-l3 bg-risk-l3-tint px-4 py-3 active:opacity-80"
    >
      <Icon as={TriangleAlert} size={20} color={warn} />
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-bold text-foreground">效期提醒</Text>
        <ExpirySummary expiredCount={expired.length} expiringCount={expiring.length} />
      </View>
      <Text className="text-sm font-semibold text-foreground">去药箱</Text>
      <Icon as={ChevronRight} size={18} color={warn} />
    </Pressable>
  );
}
