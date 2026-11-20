import { useState } from "react";
import { Pressable, View } from "react-native";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Info,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import type {
  Citation,
  ConsultClarifyOption,
  ConsultSections,
  ConsultStatus,
  RiskLevel,
} from "@anxin/shared";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * 常规回答卡（照 web `components/domain/consult/AnswerCard.tsx` 重写渲染层）。
 * 结构：sections 五段 → notice；L0（manual/未核验）先渲染「原文摘录」提示，原文收进展开区。
 * L4 不走本卡（EmergencyCard）；blocked=true 时仍全量渲染守门固定文案（用户需要看到拒答原因）。
 *
 * 风险等级/状态/来源徽章按产品新口径从患者界面移除（仅保留正文与 citations）。
 *
 * 令牌色按 mobile 口径改用实色 `*-tint`（web 的 `/10|/30` alpha 类在 RN 侧整条不落产物）。
 */

export interface AnswerCardProps {
  riskLevel: RiskLevel;
  status: ConsultStatus;
  answer: string;
  sections: ConsultSections | null;
  citations: Citation[];
  notice?: string | null;
  l0Notice?: string | null;
  blocked?: boolean;
  toolUsed?: string | null;
  /** 对象澄清选项（仅 status='clarify'，M13-P1）：点选后由页面带 drugId 重发原问题。 */
  clarifyOptions?: ConsultClarifyOption[] | null;
  onPickDrug?: (drugId: string) => void;
  /** 说明书分段落页入口（2026-11-20）：有值时渲染「查看完整说明书」按钮。 */
  onViewLeaflet?: () => void;
}

/** 组装中文播报文本（照 web `buildSpeakText`，web 冻结不抽公共，05f §0-6）。 */
export function buildSpeakText(
  sections: ConsultSections | null,
  answer: string,
  notice?: string | null,
): string {
  const parts: string[] = [];
  if (sections) {
    parts.push(sections.summary);
    if (sections.keyPoints.length > 0) parts.push(`需要知道，${sections.keyPoints.join("；")}`);
    if (sections.risks.length > 0) parts.push(`注意风险，${sections.risks.join("；")}`);
    parts.push(`下一步，${sections.nextAction}`);
    if (sections.warning) parts.push(sections.warning);
  } else if (answer) {
    parts.push(answer);
  }
  if (notice) parts.push(notice);
  return parts
    .filter(Boolean)
    .map((s) => s.replace(/[。.]+$/, "").trim())
    .filter(Boolean)
    .join("。");
}

export function AnswerCard({
  status,
  answer,
  sections,
  notice,
  l0Notice,
  citations,
  blocked,
  clarifyOptions,
  onPickDrug,
  onViewLeaflet,
}: AnswerCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const riskL2 = useUnstableNativeVariable("--risk-l2");
  const riskL3 = useUnstableNativeVariable("--risk-l3");
  // L0 资料查询（manual 档 / 说明书未核验）：原文摘录，不是个性化回答。
  const isL0 = Boolean(l0Notice);
  // 只有 manual-gate（L0 原文卡）用「说明书原文」语义标签；可用性回答仍是普通小结。
  const isRawLeaflet = isL0 && status === "manual-gate";
  const source = citations[0];
  const reviewText =
    source?.reviewStatus === "reviewed"
      ? "已人工核验"
      : source?.reviewStatus
        ? "未人工核验"
        : null;
  const identityLine = source
    ? `${[source.drugName, source.specification].filter(Boolean).join(" · ")} · ${source.source}（版本 ${source.version}）`
    : null;
  const metaLine = [
    source?.approvalNumbers?.length ? `批准文号：${source.approvalNumbers.join("、")}` : null,
    reviewText ? `核验状态：${reviewText}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View
      className={cn(
        "rounded-2xl border bg-card p-4",
        blocked ? "border-risk-l3" : "border-border",
      )}
    >
      {isL0 ? (
        <View className="mb-3 gap-1 rounded-xl border border-risk-l2 bg-risk-l2-tint p-2.5">
          <View className="flex-row items-start gap-1.5">
            <Icon as={ShieldAlert} size={16} color={riskL2} />
            <Text className="flex-1 text-sm font-medium leading-5 text-risk-l2">{l0Notice}</Text>
          </View>
          {identityLine ? (
            <Text className="pl-5 text-xs leading-4 text-muted-foreground">{identityLine}</Text>
          ) : null}
          {metaLine ? (
            <Text className="pl-5 text-xs leading-4 text-muted-foreground">{metaLine}</Text>
          ) : null}
        </View>
      ) : null}

      {sections ? (
        <View className="gap-3">
          <View className="gap-1">
            <Text className="text-sm font-medium text-muted-foreground">
              {isRawLeaflet ? "说明书原文" : "简明结论"}
            </Text>
            <Text className="text-lg font-semibold leading-7 text-card-foreground">
              {sections.summary}
            </Text>
          </View>

          {sections.keyPoints.length > 0 ? (
            <View className="gap-1">
              <View className="flex-row items-center gap-1.5">
                <Icon as={Info} size={16} color={mutedForeground} />
                <Text className="text-sm font-medium text-muted-foreground">
                  {isRawLeaflet ? "注意事项" : "需要知道"}
                </Text>
              </View>
              <View className="gap-1.5 pl-1">
                {sections.keyPoints.map((item) => (
                  <View key={item} className="flex-row items-start gap-2">
                    <View className="mt-2 size-1.5 rounded-full bg-muted-foreground" />
                    <Text className="flex-1 text-base leading-6 text-card-foreground">{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {sections.details && sections.details.length > 0 ? (
            <View className="gap-1">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: detailsOpen }}
                onPress={() => setDetailsOpen((v) => !v)}
                className="min-h-[44px] flex-row items-center justify-between gap-2 rounded-xl border border-border bg-muted px-3 active:opacity-80"
              >
                <Text className="text-sm font-medium text-muted-foreground">
                  展开原文（{sections.details.length} 条）
                </Text>
                <Icon as={detailsOpen ? ChevronUp : ChevronDown} size={18} color={mutedForeground} />
              </Pressable>
              {detailsOpen ? (
                <View className="gap-2 pl-1">
                  {sections.details.map((d) => (
                    <View key={`${d.title}-${d.body}`} className="gap-0.5">
                      <Text className="text-sm font-semibold text-card-foreground">{d.title}</Text>
                      <Text className="text-sm leading-5 text-muted-foreground">{d.body}</Text>
                      {d.source ? (
                        <Text className="text-xs leading-4 text-muted-foreground">
                          来源：{d.source}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {sections.risks.length > 0 ? (
            <View className="gap-1">
              <View className="flex-row items-center gap-1.5">
                <Icon as={AlertTriangle} size={16} color={riskL3} />
                <Text className="text-sm font-medium text-risk-l3">
                  {isRawLeaflet ? "禁忌" : "注意风险"}
                </Text>
              </View>
              <View className="gap-1.5 pl-1">
                {sections.risks.map((item) => (
                  <View key={item} className="flex-row items-start gap-2">
                    <View className="mt-2 size-1.5 rounded-full bg-risk-l3" />
                    <Text className="flex-1 text-base leading-6 text-card-foreground">{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View className="flex-row items-start gap-2 rounded-xl border border-border bg-muted p-3">
            <Icon as={ChevronRight} size={18} color={mutedForeground} />
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-medium text-muted-foreground">下一步</Text>
              <Text className="text-base font-semibold leading-6 text-card-foreground">
                {sections.nextAction}
              </Text>
            </View>
          </View>

          <View className="flex-row items-start gap-1.5">
            <Icon as={ShieldCheck} size={16} color={mutedForeground} />
            <Text className="flex-1 text-sm leading-5 text-muted-foreground">
              {sections.warning}
            </Text>
          </View>
        </View>
      ) : (
        <Text className="text-base leading-6 text-card-foreground">{answer}</Text>
      )}

      {onViewLeaflet ? (
        <Pressable
          accessibilityRole="button"
          onPress={onViewLeaflet}
          className="mt-3 min-h-[44px] flex-row items-center justify-between rounded-xl border border-primary bg-primary-tint px-3 active:opacity-80"
        >
          <Text className="text-base font-medium text-primary">查看完整说明书</Text>
          <Icon as={ChevronRight} size={18} color={mutedForeground} />
        </Pressable>
      ) : null}

      {notice ? (
        <View className="mt-3 flex-row items-start gap-1.5 rounded-xl border border-risk-l2 bg-risk-l2-tint p-2.5">
          <Icon as={Info} size={16} color={riskL2} />
          <Text className="flex-1 text-sm leading-5 text-risk-l2">{notice}</Text>
        </View>
      ) : null}

      {clarifyOptions && clarifyOptions.length > 0 ? (
        <View className="mt-3 gap-2">
          <Text className="text-sm font-medium text-muted-foreground">选择一种药继续：</Text>
          <View className="flex-row flex-wrap gap-2">
            {clarifyOptions.map((option) => (
              <Pressable
                key={option.drugId}
                accessibilityRole="button"
                onPress={() => onPickDrug?.(option.drugId)}
                className="min-h-[44px] justify-center rounded-full border-2 border-primary px-4 active:opacity-80"
              >
                <Text className="text-base text-primary">{option.drugName}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
