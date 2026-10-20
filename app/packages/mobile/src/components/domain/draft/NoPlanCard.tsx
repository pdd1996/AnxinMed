import { Text, View } from "react-native";
import { useUnstableNativeVariable } from "nativewind";
import { CalendarClock, Check, Package } from "lucide-react-native";
import type { DraftPayload } from "@anxin/core";
import { DraftCard, WarnNote } from "@/components/domain/draft/DraftCard";

/**
 * 「本次仅建档」卡（M5-T6c，对齐 web `draft/SigCard.tsx` 里的 NoPlanCard 逐字）。
 * 入口 B（药盒/标签）与降级草稿都走这里：结构上没有医嘱用法用量，系统不生成——把「为什么没有计划」
 * 说明白，并给出下一步（去药箱手动创建计划）。
 * 与 web 的组织差异：web 把本卡塞在 SigCard.tsx 里，RN 拆成独立文件（SigCard 归 T6-d）。
 */
export function NoPlanCard({ payload }: { payload: DraftPayload }) {
  const primary = useUnstableNativeVariable("--primary");
  const riskL1 = useUnstableNativeVariable("--risk-l1");
  const riskL3 = useUnstableNativeVariable("--risk-l3");

  return (
    <DraftCard
      icon={<Package size={18} color={primary} importantForAccessibility="no" />}
      title="本次仅建档 · 计划稍后手动创建"
    >
      <WarnNote
        icon={
          <CalendarClock
            size={18}
            color={riskL3}
            importantForAccessibility="no"
            style={{ marginTop: 2 }}
          />
        }
      >
        {payload.labelNotice
          ? "检测到医院标签层：标签用法不会被自动抄录。"
          : payload.type === "drug"
            ? "药盒上没有医嘱用法用量，系统不会替你生成。"
            : "本次未能从处方原文抽出用法用量。"}
        确认后请到「药箱」为该药<Text className="font-semibold">手动创建计划</Text>
        （按处方 / 说明书 / 药师指导填写），创建时会跑说明书范围校验与相互作用检查。
      </WarnNote>
      <View className="flex-row items-start gap-2">
        <Check size={16} color={riskL1} importantForAccessibility="no" style={{ marginTop: 2 }} />
        <Text className="flex-1 text-xs leading-5 text-muted-foreground">
          已理解：本次不产生服药计划（药盒/标签结构上不含医嘱用法用量，非遗漏）。
        </Text>
      </View>
    </DraftCard>
  );
}