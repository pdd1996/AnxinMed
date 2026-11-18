import { View } from "react-native";
import { AlertTriangle, ChevronRight, Info, ShieldCheck } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import type { Citation, ConsultSections, ConsultStatus, RiskLevel } from "@anxin/shared";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * 常规回答卡（照 web `components/domain/consult/AnswerCard.tsx` 重写渲染层）。
 * 结构：sections 五段 → notice/l0Notice。
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
  answer,
  sections,
  notice,
  l0Notice,
  blocked,
}: AnswerCardProps) {
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const riskL2 = useUnstableNativeVariable("--risk-l2");
  const riskL3 = useUnstableNativeVariable("--risk-l3");

  return (
    <View
      className={cn(
        "rounded-2xl border bg-card p-4",
        blocked ? "border-risk-l3" : "border-border",
      )}
    >
      {sections ? (
        <View className="gap-3">
          <View className="gap-1">
            <Text className="text-sm font-medium text-muted-foreground">简明结论</Text>
            <Text className="text-lg font-semibold leading-7 text-card-foreground">
              {sections.summary}
            </Text>
          </View>

          {sections.keyPoints.length > 0 ? (
            <View className="gap-1">
              <View className="flex-row items-center gap-1.5">
                <Icon as={Info} size={16} color={mutedForeground} />
                <Text className="text-sm font-medium text-muted-foreground">需要知道</Text>
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

          {sections.risks.length > 0 ? (
            <View className="gap-1">
              <View className="flex-row items-center gap-1.5">
                <Icon as={AlertTriangle} size={16} color={riskL3} />
                <Text className="text-sm font-medium text-risk-l3">注意风险</Text>
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

      {notice ? (
        <View className="mt-3 flex-row items-start gap-1.5 rounded-xl border border-risk-l2 bg-risk-l2-tint p-2.5">
          <Icon as={Info} size={16} color={riskL2} />
          <Text className="flex-1 text-sm leading-5 text-risk-l2">{notice}</Text>
        </View>
      ) : null}

      {l0Notice ? (
        <View className="mt-3 flex-row items-start gap-1.5 rounded-xl border border-muted-foreground bg-muted p-2.5">
          <Icon as={ShieldCheck} size={16} color={mutedForeground} />
          <Text className="flex-1 text-sm leading-5 text-muted-foreground">{l0Notice}</Text>
        </View>
      ) : null}
    </View>
  );
}
