import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { apiBaseUrl, API_URL_MISSING_HINT, isApiConfigured } from "@/lib/wiring";
import { TAB_BAR_BOTTOM_PAD } from "@/lib/layout";

interface Entry {
  href: Href;
  title: string;
  desc: string;
}

/** 今日 tab 上已可用的入口（T5-b 接今日任务后由任务卡承接主视觉，此处保留动作入口）。 */
const ENTRIES: Entry[] = [
  {
    href: "/intake",
    title: "拍药盒入药箱",
    desc: "拍一张药盒正面 → 识别 → 你核对 → 进药箱",
  },
  {
    href: "/probe",
    title: "网络探测",
    desc: "确认这台设备能连上服务器",
  },
];

const SOON: { title: string; when: string }[] = [
  { title: "今日待服任务与到点提醒", when: "M5-T5b / M5-T8" },
  { title: "拍处方笺（含用法用量）", when: "M5-T6" },
  { title: "AI 用药咨询", when: "M5-T7" },
];

/** 首页（今日）：M5-T4 的骨架入口，M5-T5a 迁入 (patient) 五 tab 的第一槽。 */
export default function Today() {
  const router = useRouter();
  const configured = isApiConfigured();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingBottom: TAB_BAR_BOTTOM_PAD,
        paddingTop: 16,
      }}
    >
      <Text className="text-xs font-bold uppercase tracking-[2px] text-primary">今日</Text>
      <Text className="mt-1 text-2xl font-bold text-foreground">安心用药</Text>
      <Text className="mt-1 text-base leading-6 text-muted-foreground">
        把一个人的药放进同一个药箱：先能拍照建档，再管依从、冲突与效期。
      </Text>

      <View
        className={`mt-5 rounded-2xl border p-4 ${
          configured ? "border-border bg-card" : "border-red-300 bg-red-50"
        }`}
      >
        <Text className="text-sm text-muted-foreground">服务器地址</Text>
        <Text className={`mt-1 text-base ${configured ? "text-card-foreground" : "text-red-700"}`}>
          {configured ? apiBaseUrl() : API_URL_MISSING_HINT}
        </Text>
      </View>

      <View className="mt-6 gap-3">
        {ENTRIES.map((entry) => (
          <Pressable
            key={entry.title}
            accessibilityRole="button"
            onPress={() => router.push(entry.href)}
            className="min-h-[76px] justify-center rounded-2xl border border-border bg-card px-4 py-3 active:opacity-80"
          >
            <Text className="text-xl font-semibold text-card-foreground">{entry.title}</Text>
            <Text className="mt-1 text-sm text-muted-foreground">{entry.desc}</Text>
          </Pressable>
        ))}
      </View>

      <Text className="mt-8 text-lg font-semibold text-foreground">还在路上</Text>
      <View className="mt-2 gap-2">
        {SOON.map((item) => (
          <View
            key={item.title}
            className="flex-row items-center justify-between rounded-xl border border-dashed border-border px-4 py-3"
          >
            <Text className="flex-1 text-base text-muted-foreground">{item.title}</Text>
            <Text className="ml-3 text-xs text-muted-foreground">{item.when}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
