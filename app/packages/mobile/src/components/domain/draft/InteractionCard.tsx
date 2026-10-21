import { Text, View } from "react-native";
import { useUnstableNativeVariable } from "nativewind";
import { HeartPulse, Info, OctagonX, ShieldCheck, TriangleAlert } from "lucide-react-native";
import { INTERACTION_LEVEL_ORDER, type InteractionLevel } from "@anxin/shared";
import type { DraftPayload } from "@anxin/core";
import { DraftCard } from "@/components/domain/draft/DraftCard";

/**
 * 相互作用检查结果区（M5-T6c，对齐 web `draft/RiskCards.tsx`，PRD §7.8.2：提示不阻止创建、不自动改方案）。
 * 分级色四档走 risk 实色令牌对 + 图标 + 文字（不单靠颜色）；空态出 `coverageNote`。
 */
type Interaction = NonNullable<DraftPayload["interactions"]>;
type Hit = Interaction["hits"][number];

/** 四级 → 图标 + 令牌（禁忌 > 慎用 > 需监测 > 注意）。 */
const LEVEL_META: Record<InteractionLevel, { icon: typeof Info; box: string; token: string }> = {
  禁忌: { icon: OctagonX, box: "border-risk-l4 bg-risk-l4-tint", token: "--risk-l4" },
  慎用: { icon: TriangleAlert, box: "border-risk-l3 bg-risk-l3-tint", token: "--risk-l3" },
  需监测: { icon: HeartPulse, box: "border-risk-l2 bg-risk-l2-tint", token: "--risk-l2" },
  注意: { icon: Info, box: "border-risk-l2 bg-risk-l2-tint", token: "--risk-l2" },
};

function sortedHits(hits: Hit[]): Hit[] {
  return [...(hits ?? [])].sort(
    (a, b) => (INTERACTION_LEVEL_ORDER[b.level] ?? 0) - (INTERACTION_LEVEL_ORDER[a.level] ?? 0),
  );
}

/** 命中项列表（确认前草稿值 / 确认后重跑值共用；T6-d 的结果弹窗也要引这里）。 */
export function HitList({ hits }: { hits: Hit[] }) {
  return (
    <View className="gap-2">
      {sortedHits(hits).map((hit, i) => (
        <HitRow key={`${hit.level}-${i}`} hit={hit} />
      ))}
    </View>
  );
}

function HitRow({ hit }: { hit: Hit }) {
  const meta = LEVEL_META[hit.level] ?? LEVEL_META["注意"];
  const Icon = meta.icon;
  const color = useUnstableNativeVariable(meta.token);
  return (
    <View className={`flex-row items-start gap-2 rounded-xl border p-3 ${meta.box}`}>
      <Icon size={18} color={color} importantForAccessibility="no" style={{ marginTop: 2 }} />
      <View className="min-w-0 flex-1">
        <View className="flex-row flex-wrap items-center gap-2">
          <View className="rounded-full border border-border bg-background px-2 py-0.5">
            <Text className="text-xs font-semibold text-foreground">{hit.level}</Text>
          </View>
          <Text className="min-w-0 flex-1 text-sm leading-5 text-foreground">{hit.note}</Text>
        </View>
        <Text className="mt-1 text-xs leading-5 text-foreground opacity-85">
          涉及：{(hit.drugNames ?? []).join("、") || "—"} · 来源：{hit.source}
        </Text>
      </View>
    </View>
  );
}

export function InteractionCard({ result }: { result: Interaction | null }) {
  const primary = useUnstableNativeVariable("--primary");
  const riskL1 = useUnstableNativeVariable("--risk-l1");
  const hits = result?.hits ?? [];
  return (
    <DraftCard
      icon={<ShieldCheck size={18} color={primary} importantForAccessibility="no" />}
      title="相互作用检查"
      subtitle="对象：本药 × 你当前生效的计划集合"
    >
      {hits.length > 0 ? (
        <>
          <HitList hits={hits} />
          <Text className="text-xs leading-5 text-muted-foreground">
            提示<Text className="font-semibold">不阻止</Text>
            确认、也不会替你改方案 —— 请带着这条提示咨询医生或药师。
          </Text>
        </>
      ) : (
        <View className="flex-row items-start gap-2 rounded-xl border border-border bg-muted p-3">
          <ShieldCheck size={18} color={riskL1} importantForAccessibility="no" style={{ marginTop: 2 }} />
          <Text className="flex-1 text-sm leading-5 text-foreground">
            {result?.coverageNote ??
              "当前生效计划集合未见已知相互作用。规则库为演示抄录、覆盖有限，未覆盖不表示无风险。"}
          </Text>
        </View>
      )}
    </DraftCard>
  );
}