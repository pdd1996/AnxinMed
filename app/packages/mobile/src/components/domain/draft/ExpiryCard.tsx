import { View } from "react-native";
import { CalendarDays } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import type { ConfirmFormState } from "@anxin/core";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DateField } from "@/components/domain/DateField";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

/**
 * 有效期 / 开封日期卡（PRD §7.3.4 三条时间线里的「药盒实物时间线」）。
 * 药盒包装上的具体到期日只能由用户对照实物录入：管线不产出、也不预填猜测。
 * 留空 = 未录入（可稍后在药箱补录）；允许已过期日期（要能录、能纠正）；录错或换新盒随时改。
 * 与 IdentityCard 同款 Card 结构；值直接绑 ConfirmFormState.expiry / openedAt，
 * buildConfirm 会把 '' 落成 null，服务端入参校验 YYYY-MM-DD（shared IsoDateSchema）。
 */
export function ExpiryCard({
  state,
  patch,
}: {
  state: ConfirmFormState;
  patch: (partial: Partial<ConfirmFormState>) => void;
}) {
  const primary = useUnstableNativeVariable("--primary");

  return (
    <Card>
      <CardHeader>
        <View className="flex-row flex-wrap items-center gap-2">
          <Icon as={CalendarDays} size={20} color={primary} />
          <CardTitle className="text-lg text-card-foreground">有效期与开封日期</CardTitle>
          <Text className="text-xs text-muted-foreground">对照药盒实物填写 · 不预填、不猜测</Text>
        </View>
      </CardHeader>
      <CardContent className="gap-4">
        <View className="gap-1">
          <Text className="text-base font-bold text-foreground">有效期至</Text>
          <DateField
            value={state.expiry}
            onChange={(next) => patch({ expiry: next })}
            labelPrefix="有效期"
            optional
          />
        </View>
        <View className="gap-1">
          <Text className="text-base font-bold text-foreground">开封日期（可选）</Text>
          <DateField
            value={state.openedAt}
            onChange={(next) => patch({ openedAt: next })}
            labelPrefix="开封日期"
            optional
          />
        </View>
        <View className="gap-1 rounded-xl border border-dashed border-border bg-muted p-3">
          <Text className="text-sm leading-5 text-foreground">
            以药盒包装上的具体到期日为准；说明书通常只写通用保质期（如 24
            个月），不能代替这盒药的到期日。
          </Text>
          <Text className="text-xs leading-5 text-muted-foreground">
            留空 = 还没录入，可稍后在药箱补录；允许填已过期日期（用于提示弃药）；录错或换新盒可随时回药箱修改。
          </Text>
        </View>
      </CardContent>
    </Card>
  );
}
