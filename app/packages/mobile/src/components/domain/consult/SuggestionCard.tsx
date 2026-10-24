import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Camera, Hand, MessageSquareHeart, Pill } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { acceptSuggestion, dismissSuggestion } from "@anxin/core";
import type { ConsultSuggestion } from "@anxin/shared";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

/**
 * 确认式建议卡（照 web `components/domain/consult/SuggestionCard.tsx` 重写渲染层）。
 * - add_drug：透明告知 L0 门禁差异，拍照/手动双路径；accept 只换入口目标，实际建档必经既有确认页；
 * - note_symptom：纯引导去健康信息，无 accept。
 * 失败不静默：接口失败时卡片保留并显示中文错误，可重试。
 */
export function SuggestionCard({ suggestion }: { suggestion: ConsultSuggestion }) {
  const router = useRouter();
  const primary = useUnstableNativeVariable("--primary");
  const primaryForeground = useUnstableNativeVariable("--primary-foreground");
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (gone) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作没能完成，请重试。");
    } finally {
      setBusy(false);
    }
  };

  if (suggestion.type === "note_symptom") {
    return (
      <View className="rounded-2xl border-2 border-primary bg-card p-4">
        <View className="flex-row items-center gap-2">
          <Icon as={MessageSquareHeart} size={20} color={primary} />
          <Text className="text-base font-bold text-primary">记到健康信息里吧</Text>
        </View>
        <Text className="mt-2 text-base leading-6 text-card-foreground">
          你提到了身体不适。把它记录到「健康信息」，方便就医时向医生说明；AI
          不会根据这些信息做诊断。
        </Text>
        <View className="mt-3 flex-row flex-wrap gap-2">
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => router.push("/profile")}
            className="min-h-[44px] items-center justify-center rounded-xl bg-primary px-4 active:opacity-80"
          >
            <Text className="text-base font-medium text-primary-foreground">去健康信息</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => setGone(true)}
            className="min-h-[44px] items-center justify-center rounded-xl px-4 active:opacity-80"
          >
            <Text className="text-base text-muted-foreground">忽略</Text>
          </Pressable>
        </View>
        {error ? <Text className="mt-2 text-sm text-risk-l4">{error}</Text> : null}
      </View>
    );
  }

  const accept = (path: "ocr" | "manual") =>
    run(async () => {
      const { target } = await acceptSuggestion(suggestion.id, path);
      setGone(true);
      router.push(target as Href);
    });

  return (
    <View className="rounded-2xl border-2 border-primary bg-card p-4">
      <View className="flex-row items-center gap-2">
        <Icon as={Pill} size={20} color={primary} />
        <Text className="flex-1 text-base font-bold text-primary">
          要把「{suggestion.drugName}」加入药箱吗？
        </Text>
      </View>
      <Text className="mt-2 text-sm leading-5 text-muted-foreground">
        两种方式都可建档：拍照建档保留完整 AI 咨询；手动建档未经拍照确认，仅可查药品说明书资料（L0）。
        建档信息需经你确认后才会写入药箱。
      </Text>
      <View className="mt-3 flex-row flex-wrap gap-2">
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void accept("ocr")}
          className="min-h-[44px] flex-row items-center gap-1.5 rounded-xl bg-primary px-4 active:opacity-80"
        >
          <Icon as={Camera} size={18} color={primaryForeground} />
          <Text className="text-base font-medium text-primary-foreground">拍照建档</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void accept("manual")}
          className="min-h-[44px] flex-row items-center gap-1.5 rounded-xl border border-border px-4 active:opacity-80"
        >
          <Icon as={Hand} size={18} color={primary} />
          <Text className="text-base font-medium text-foreground">手动建档</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() =>
            void run(async () => {
              await dismissSuggestion(suggestion.id);
              setGone(true);
            })
          }
          className="min-h-[44px] items-center justify-center rounded-xl px-4 active:opacity-80"
        >
          <Text className="text-base text-muted-foreground">忽略</Text>
        </Pressable>
      </View>
      {error ? <Text className="mt-2 text-sm text-risk-l4">{error}</Text> : null}
    </View>
  );
}
