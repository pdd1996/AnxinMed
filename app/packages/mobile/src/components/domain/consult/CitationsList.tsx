import { useState } from "react";
import { Pressable, View } from "react-native";
import { ChevronDown, ChevronUp, ShieldAlert } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import type { Citation } from "@anxin/shared";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * citations 折叠展示（照 web `components/domain/consult/CitationsList.tsx` 重写渲染层）。
 * 默认收起（只显示「来源 N 条」），展开后药名 + source + 版本 + 段落名；空数组不占空间。
 * SECTION_KEY_LABELS 与 web 同源复制——web 冻结，不为了共用去改它（05f §0-6）。
 */
const SECTION_KEY_LABELS: Record<string, string> = {
  indication: "适应症段",
  pharmacology: "药理毒理段",
  interactions: "相互作用段",
  adverse: "不良反应段",
  contraindication: "禁忌段",
  components: "成份段",
  precautions: "注意事项段",
  storage: "储存说明",
  dosage: "医嘱提示",
};

function sectionText(c: Citation): string | null {
  if (c.sectionLabel) return `${c.sectionLabel}段`;
  if (c.sectionKey) return SECTION_KEY_LABELS[c.sectionKey] ?? null;
  return null;
}

export function CitationsList({
  citations,
  className,
}: {
  citations: Citation[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const riskL3 = useUnstableNativeVariable("--risk-l3");

  if (!citations || citations.length === 0) return null;

  return (
    <View className={cn("mt-3 border-t border-border pt-3", className)}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        className="min-h-[44px] flex-row items-center justify-between gap-2 active:opacity-80"
      >
        <Text className="text-base text-muted-foreground">
          来源 <Text className="font-bold text-foreground">{citations.length}</Text> 条
        </Text>
        <Icon
          as={open ? ChevronUp : ChevronDown}
          size={20}
          color={mutedForeground}
        />
      </Pressable>

      {open ? (
        <View className="mt-2 gap-2">
          {citations.map((c, idx) => (
            <View
              key={`${c.drugName}-${c.source}-${c.version}-${idx}`}
              className="rounded-xl border border-border bg-muted p-3"
            >
              <View className="flex-row items-start justify-between gap-2">
                <Text className="flex-1 text-base font-semibold text-card-foreground">
                  {c.drugName}
                </Text>
                {c.unverified ? (
                  <View className="flex-row items-center gap-1 rounded-full border border-risk-l3 bg-risk-l3-tint px-2 py-0.5">
                    <Icon as={ShieldAlert} size={12} color={riskL3} />
                    <Text className="text-xs font-semibold text-risk-l3">未经本库核实</Text>
                  </View>
                ) : null}
              </View>
              <Text className="mt-1 text-sm leading-5 text-muted-foreground">
                来源：{c.source}
                {sectionText(c) ? `（${sectionText(c)}）` : ""}
              </Text>
              <Text className="mt-0.5 text-sm leading-5 text-muted-foreground">
                版本：{c.version}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
