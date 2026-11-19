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

/** 「N 种药已过期」/「M 种药 30 天内到期」，只拼非空桶。 */
function summaryText(expiredCount: number, expiringCount: number, separator: string): string {
  const parts: string[] = [];
  if (expiredCount > 0) parts.push(`${expiredCount} 种药已过期`);
  if (expiringCount > 0) parts.push(`${expiringCount} 种药 ${EXPIRY_WARNING_DAYS} 天内到期`);
  return parts.join(separator);
}

/** 明细里的到期描述：已过期（X 天前）/ 今天到期 / 剩 X 天。 */
function detailText(entry: ExpiryEntry): string {
  const date = entry.drug.expiry ?? "";
  if (entry.days < 0) return `${date} 到期，已过期（${-entry.days} 天前）`;
  if (entry.days === 0) return `${date} 到期（今天到期）`;
  return `${date} 到期（剩 ${entry.days} 天）`;
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
        <Text className="text-base font-bold text-foreground">效期提醒</Text>
      </View>
      <Text className="mt-1 text-sm font-semibold leading-5 text-foreground">
        {summaryText(expired.length, expiring.length, "、")}
      </Text>

      <View className="mt-3 gap-1.5">
        {entries.map((entry) => (
          <View key={entry.drug.id} className="flex-row items-start gap-2">
            <View
              className={cn(
                "mt-1.5 size-2 rounded-full",
                entry.days < 0 ? "bg-risk-l4" : "bg-risk-l3",
              )}
            />
            <Text className="flex-1 text-sm leading-5 text-foreground">
              {`${entry.drug.genericName} · ${detailText(entry)}`}
            </Text>
          </View>
        ))}
        {overflow > 0 ? (
          <Text className="text-xs leading-5 text-foreground">
            …等 {overflow} 种，去药箱逐条查看
          </Text>
        ) : null}
      </View>

      <Text className="mt-3 text-xs leading-5 text-foreground">
        过期药请勿继续服用，请按说明书或药师指导处理。
      </Text>
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

  const summary = summaryText(expired.length, expiring.length, " / ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`效期提醒：${summary}。去药箱查看`}
      onPress={() => router.push("/box")}
      className="mt-4 min-h-[48px] flex-row items-center gap-3 rounded-2xl border-2 border-risk-l3 bg-risk-l3-tint px-4 py-3 active:opacity-80"
    >
      <Icon as={TriangleAlert} size={20} color={warn} />
      <Text className="flex-1 text-sm font-semibold leading-5 text-foreground">
        {`效期提醒：${summary}`}
      </Text>
      <Text className="text-sm font-semibold text-foreground">去药箱</Text>
      <Icon as={ChevronRight} size={18} color={warn} />
    </Pressable>
  );
}
