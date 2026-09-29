import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { apiBaseUrl, API_URL_MISSING_HINT, isApiConfigured } from "@/lib/wiring";

interface Entry {
  href: string;
  title: string;
  desc: string;
  /** 本里程碑内的可用性：T4 只打通药盒一条线，其余入口如实标注，不做点了没反应的按钮。 */
  ready: boolean;
  when?: string;
}

const ENTRIES: Entry[] = [
  {
    href: "/intake",
    title: "拍药盒入药箱",
    desc: "拍一张药盒照片 → 识别 → 你核对 → 进药箱",
    ready: true,
  },
  { href: "/box", title: "我的药箱", desc: "查看已建档的药品", ready: true },
  {
    href: "/probe",
    title: "网络探测",
    desc: "确认这台设备能连上服务器",
    ready: true,
  },
];

const SOON: { title: string; when: string }[] = [
  { title: "拍处方笺（含用法用量）", when: "M5-T6" },
  { title: "服药提醒与语音播报", when: "M5-T8" },
  { title: "AI 用药咨询", when: "M5-T7" },
];

/** 首页（M5-T4 骨架）：三个已可用入口 + 未接入项如实列出 + API 地址可见。 */
export default function Index() {
  const router = useRouter();
  const configured = isApiConfigured();

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: 16 }}>
      <Text className="text-2xl font-bold text-foreground">安心用药</Text>
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
            key={entry.href}
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
            <Text className="text-base text-muted-foreground">{item.title}</Text>
            <Text className="text-xs text-muted-foreground">{item.when}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
