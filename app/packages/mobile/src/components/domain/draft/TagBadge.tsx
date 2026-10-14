import { View } from "react-native";
import { TAG_META, type TagKind } from "@anxin/shared";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * 四类标注徽章（对齐 web `domain/draft/TagBadge.tsx`，PRD §7.2.4）。
 * 与 web 的唯一差异是底色：`bg-risk-lN/10`、`bg-primary/10` 这一族带 alpha 的类在 RN 侧整条不落产物
 * （05d §7-7），故换成算好的实色 `*-tint` 令牌；文字一律 `text-foreground`，
 * 因为彩色文字压在 tint 上够不上老年向对比（同 05e §2-T6-b 的那条口径）。
 */
const TONE: Record<TagKind, string> = {
  transcribed: "border-risk-l2 bg-risk-l2-tint",
  assist: "border-border bg-secondary",
  derived: "border-risk-l1 bg-risk-l1-tint",
  default: "border-border bg-muted",
  user: "border-primary bg-secondary",
};

export function TagBadge({ kind, className }: { kind?: TagKind | null; className?: string }) {
  if (!kind) return null;
  const meta = TAG_META[kind];
  return (
    <View
      accessibilityLabel={`${meta.label}：${meta.hint}`}
      className={cn(
        "flex-row items-center self-start rounded-full border-2 px-2.5 py-0.5",
        TONE[kind],
        className,
      )}
    >
      <Text className="text-xs font-semibold text-foreground">{meta.label}</Text>
    </View>
  );
}
