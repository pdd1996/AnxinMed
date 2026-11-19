import { useState } from "react";
import { Pressable, View } from "react-native";
import { ShieldAlert } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { INTERACTION_LEVEL_ORDER, type InteractionLevel } from "@anxin/shared";
import type { SafetySummaryDto } from "@anxin/core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { InteractionHitList } from "@/components/domain/draft/RiskCards";
import { cn } from "@/lib/utils";

/**
 * 用药安全常驻卡（V2.5 · PRD §7.8.2「主动干预」）—— 首页与药箱顶部展示。
 *
 * 数据来自 GET /api/safety（0 次 LLM，检查对象 = 生效计划集合）：无命中时整卡不渲染（不制造噪声），
 * 有命中时按最重级别着色 + 图标 + 文字三件套（老年向不单靠颜色），点按展开逐条原文与来源。
 * 规则库规模与「演示/已核验」状态在卡内如实展示（M8：演示条目不得冒充正式库）；未覆盖 ≠ 无风险。
 */
const LEVEL_STYLE: Record<InteractionLevel, { shell: string; tone: "l4" | "l3" | "l2" }> = {
  禁忌: { shell: "border-risk-l4 bg-risk-l4-tint", tone: "l4" },
  慎用: { shell: "border-risk-l3 bg-risk-l3-tint", tone: "l3" },
  需监测: { shell: "border-risk-l2 bg-risk-l2-tint", tone: "l2" },
  注意: { shell: "border-risk-l2 bg-risk-l2-tint", tone: "l2" },
};

function worstLevel(hits: SafetySummaryDto["interactions"]["hits"]): InteractionLevel {
  return [...hits].sort(
    (a, b) => (INTERACTION_LEVEL_ORDER[b.level] ?? 0) - (INTERACTION_LEVEL_ORDER[a.level] ?? 0),
  )[0]?.level ?? "注意";
}

/**
 * 某个药（按 drug_master.id）在安全汇总里涉及的最重相互作用级别。
 * 药箱药卡角标用：有命中才显示，避免整页红点噪声。
 */
export function worstInteractionLevelForDrug(
  summary: SafetySummaryDto | undefined,
  drugMasterId: string | null | undefined,
): InteractionLevel | null {
  if (!summary || !drugMasterId) return null;
  let worst: InteractionLevel | null = null;
  for (const hit of summary.interactions.hits) {
    if (!hit.drugIds.includes(drugMasterId)) continue;
    if (!worst || (INTERACTION_LEVEL_ORDER[hit.level] ?? 0) > (INTERACTION_LEVEL_ORDER[worst] ?? 0)) {
      worst = hit.level;
    }
  }
  return worst;
}

export function SafetyAlertCard({ summary }: { summary: SafetySummaryDto | undefined }) {
  const [open, setOpen] = useState(false);
  const riskL4 = useUnstableNativeVariable("--risk-l4");
  const riskL3 = useUnstableNativeVariable("--risk-l3");
  const riskL2 = useUnstableNativeVariable("--risk-l2");
  const hits = summary?.interactions.hits ?? [];
  if (!summary || hits.length === 0) return null;

  const level = worstLevel(hits);
  const style = LEVEL_STYLE[level];
  const iconColor = style.tone === "l4" ? riskL4 : style.tone === "l3" ? riskL3 : riskL2;
  const badgeShell =
    style.tone === "l4"
      ? "rounded-full border border-risk-l4 px-2 py-0.5"
      : style.tone === "l3"
        ? "rounded-full border border-risk-l3 px-2 py-0.5"
        : "rounded-full border border-risk-l2 px-2 py-0.5";
  const badgeTone =
    style.tone === "l4"
      ? "text-xs font-bold text-risk-l4"
      : style.tone === "l3"
        ? "text-xs font-bold text-risk-l3"
        : "text-xs font-bold text-risk-l2";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`用药安全提示：${hits.length} 项相互作用，最高${level}`}
        onPress={() => setOpen(true)}
        className={cn("mt-4 rounded-2xl border-2 p-4 active:opacity-80", style.shell)}
      >
        <View className="flex-row items-center gap-2">
          <Icon as={ShieldAlert} size={20} color={iconColor} />
          <Text className="flex-1 text-base font-bold text-foreground">用药安全提示</Text>
          <View className={badgeShell}>
            <Text className={badgeTone}>{level}</Text>
          </View>
        </View>
        <Text className="mt-1 text-sm leading-5 text-foreground">
          你当前在服的药品组合检出 {hits.length} 项相互作用提示（最高「{level}」）。点按查看原文与来源。
        </Text>
        <Text className="mt-1 text-xs leading-5 text-muted-foreground">
          规则库 {summary.ruleLibrary.total} 条（演示抄录 {summary.ruleLibrary.demo} 条）· 提示不阻止、不改方案
        </Text>
      </Pressable>

      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent className="max-h-[88vh]">
          <DialogHeader>
            <DialogTitle className="text-xl text-card-foreground">用药安全提示</DialogTitle>
            <DialogDescription className="text-sm leading-5 text-muted-foreground">
              当前生效计划集合的相互作用检查结果。只提示、不改方案，请携带本提示咨询医生或药师。
            </DialogDescription>
          </DialogHeader>
          <View className="gap-3">
            <InteractionHitList hits={hits} />
            {summary.skippedDrugNames.length > 0 ? (
              <Text className="text-xs leading-5 text-muted-foreground">
                另有 {summary.skippedDrugNames.length} 个在服药品未关联标准药品库，未参与比对：
                {summary.skippedDrugNames.join("、")}。
              </Text>
            ) : null}
            <Text className="text-xs leading-5 text-muted-foreground">
              规则库共 {summary.ruleLibrary.total} 条（演示抄录 {summary.ruleLibrary.demo} 条、已核验{" "}
              {summary.ruleLibrary.curated} 条）· 未覆盖 ≠ 无风险。
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpen(false)}
              className="min-h-[52px] items-center justify-center rounded-xl bg-primary px-6 active:opacity-80"
            >
              <Text className="text-lg font-semibold text-primary-foreground">我已知悉</Text>
            </Pressable>
          </View>
        </DialogContent>
      </Dialog>
    </>
  );
}
