import { View } from "react-native";
import { CalendarClock, Check, Package } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import type { DraftPayload } from "@anxin/core";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

/**
 * 无计划说明卡（对齐 web `domain/draft/SigCard.tsx` 的 `NoPlanCard`，入口 B / 降级草稿走这块）。
 * 逐字照搬三条分支文案与「已理解」那条；带 alpha 的浅底换成实色 tint（05d §7-7）。
 */
export function NoPlanCard({ payload }: { payload: DraftPayload }) {
  const primary = useUnstableNativeVariable("--primary");
  const ok = useUnstableNativeVariable("--risk-l1");
  const reason = payload.labelNotice
    ? "检测到医院标签层：标签用法不会被自动抄录。"
    : payload.type === "drug"
      ? "药盒上没有医嘱用法用量，系统不会替你生成。"
      : "本次未能从处方原文抽出用法用量。";

  return (
    <Card>
      <CardHeader>
        <View className="flex-row items-center gap-2">
          <Icon as={Package} size={20} color={primary} />
          <CardTitle className="text-lg text-card-foreground">
            本次仅建档 · 计划稍后手动创建
          </CardTitle>
        </View>
      </CardHeader>
      <CardContent className="gap-2">
        <View className="flex-row items-start gap-2 rounded-xl border-2 border-risk-l3 bg-risk-l3-tint p-3">
          <Icon as={CalendarClock} size={20} color={primary} style={{ marginTop: 2 }} />
          <Text className="flex-1 text-sm leading-5 text-foreground">
            {reason}
            确认后请到「药箱」为该药手动创建计划（按处方 / 说明书 / 药师指导填写），
            创建时会跑说明书范围校验与相互作用检查。
          </Text>
        </View>
        <View className="flex-row items-start gap-2">
          <Icon as={Check} size={18} color={ok} style={{ marginTop: 2 }} />
          <Text className="flex-1 text-xs leading-5 text-muted-foreground">
            已理解：本次不产生服药计划（药盒/标签结构上不含医嘱用法用量，非遗漏）。
          </Text>
        </View>
      </CardContent>
    </Card>
  );
}
