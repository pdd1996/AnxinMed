import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useUnstableNativeVariable } from "nativewind";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertTriangle, Send } from "lucide-react-native";
import {
  CONFIRM_STATUS_META,
  CONSULT_DATA_QUICK_QUESTIONS,
  CONSULT_INSERT_QUICK_QUESTIONS,
  type ConsultSkillId,
  type ConsultSuggestion,
} from "@anxin/shared";
import { fetchDrugs, postConsult, type ConsultResponseDto } from "@anxin/core";
import { guardRequest, TIMEOUT_MS } from "@/lib/net";
import { AnswerCard } from "@/components/domain/consult/AnswerCard";
import { EmergencyCard } from "@/components/domain/consult/EmergencyCard";
import { SuggestionCard } from "@/components/domain/consult/SuggestionCard";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/** 会话消息（一问一答；user 消息含 question，assistant 消息含完整响应）。 */
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  question?: string;
  response?: ConsultResponseDto;
}

let msgSeq = 0;
const nextMsgId = () => `msg-${Date.now()}-${++msgSeq}`;

/**
 * AI 咨询页（M5-T7，照 web `routes/patient/Consult.tsx` 的行为重写渲染层）。
 *
 * - 对象药 = 药箱「问这个药」深链 `?drugId=`（不做页内选药器，D1-A）；
 * - 草稿/会话/建议卡的逻辑真相全在 @anxin/core 与 shared，本页只做平台渲染；
 * - 失败一律常驻中文错误卡（可重试），不靠一闪而过的 toast；
 * - T7-b 起回答区换成 AnswerCard/EmergencyCard/CitationsList/SuggestionCard；
 *   T7-c 接会话历史与快捷问题；T7-d 接 expo-speech 播报。
 */
export default function Consult() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { drugId } = useLocalSearchParams<{ drugId?: string }>();
  const mutedForeground = useUnstableNativeVariable("--muted-foreground");
  const riskL3 = useUnstableNativeVariable("--risk-l3");
  const primaryForeground = useUnstableNativeVariable("--primary-foreground");

  const drugsQuery = useQuery({ queryKey: ["drugs"], queryFn: fetchDrugs });
  const drugs = drugsQuery.data ?? [];
  const selectedDrug = drugId ? drugs.find((d) => d.id === drugId) ?? null : null;
  const effectiveDrugId = selectedDrug?.id ?? null;
  const invalidDrugLink =
    !!drugId && !drugsQuery.isPending && !selectedDrug && drugs.length > 0;

  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<ConsultSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ text: string; skillId?: ConsultSkillId } | null>(
    null,
  );
  const scrollRef = useRef<ScrollView>(null);

  const consultMutation = useMutation({
    mutationFn: (input: { text: string; skillId?: ConsultSkillId }) =>
      guardRequest(() => {
        const drugIds = effectiveDrugId ? [effectiveDrugId] : [];
        const opts = {
          ...(sessionId ? { sessionId } : {}),
          ...(input.skillId ? { skillId: input.skillId } : {}),
        };
        return Object.keys(opts).length > 0
          ? postConsult(input.text, drugIds, opts)
          : postConsult(input.text, drugIds);
      }, TIMEOUT_MS.consult),
    onSuccess: (result, input) => {
      if (!result.ok) {
        setError(result.message);
        setFailed(input);
        return;
      }
      const response = result.data;
      setError(null);
      setFailed(null);
      setSessionId(response.sessionId);
      setSuggestion(response.suggestion ?? null);
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId(), role: "user", question: input.text },
        { id: nextMsgId(), role: "assistant", response },
      ]);
      setQuestion("");
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : "咨询请求没能完成，请重试。");
    },
  });

  const handleAsk = (q?: string, skillId?: ConsultSkillId) => {
    const text = (q ?? question).trim();
    if (!text || consultMutation.isPending) return;
    setError(null);
    consultMutation.mutate({ text, skillId });
  };

  const retry = () => {
    if (!failed || consultMutation.isPending) return;
    setError(null);
    consultMutation.mutate(failed);
  };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-background">
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {selectedDrug?.confirmStatus === "manual" ? (
          <View className="mb-4 flex-row items-start gap-2 rounded-xl border-2 border-risk-l3 bg-risk-l3-tint p-3">
            <Icon as={AlertTriangle} size={18} color={riskL3} />
            <Text className="flex-1 text-sm leading-5 text-risk-l3">
              该药品未经 OCR 确认：{CONFIRM_STATUS_META.manual.hint}
            </Text>
          </View>
        ) : null}

        {messages.length === 0 && !drugsQuery.isPending ? (
          <Text className="text-base leading-6 text-muted-foreground">
            {drugs.length === 0 ? (
              <>
                药箱为空：去
                <Text
                  className="font-semibold text-primary underline"
                  onPress={() => router.push("/intake/rx")}
                >
                  录入
                </Text>
                添加药品后可咨询说明书；现在也能直接查药箱数据。
              </>
            ) : selectedDrug ? (
              <>
                正在咨询「
                <Text className="font-semibold text-foreground">
                  {selectedDrug.genericName}
                </Text>
                」：说明书类问题围绕它回答，药箱数据也可直接问。
              </>
            ) : invalidDrugLink ? (
              "未找到要咨询的药品，请回到药箱从该药的「问这个药」重新进入。"
            ) : (
              "可直接问药箱数据；要咨询某支药的说明书，请到药箱点该药的「问这个药」。"
            )}
          </Text>
        ) : null}

        <View className="mt-4 gap-4">
          {messages.map((msg) =>
            msg.role === "user" ? (
              <View key={msg.id} className="items-end">
                <View className="max-w-[85%] rounded-2xl rounded-br-none bg-primary px-4 py-3">
                  <Text className="text-base leading-6 text-primary-foreground">
                    {msg.question}
                  </Text>
                </View>
              </View>
            ) : msg.response?.riskLevel === "L4" && msg.response.sections ? (
              <EmergencyCard key={msg.id} sections={msg.response.sections} />
            ) : msg.response ? (
              <AnswerCard
                key={msg.id}
                riskLevel={msg.response.riskLevel}
                status={msg.response.status}
                answer={msg.response.answer}
                sections={msg.response.sections ?? null}
                citations={msg.response.citations ?? []}
                notice={msg.response.notice}
                l0Notice={msg.response.l0Notice}
                blocked={msg.response.blocked}
                toolUsed={msg.response.toolUsed}
              />
            ) : null,
          )}

          {suggestion ? <SuggestionCard suggestion={suggestion} /> : null}

          {consultMutation.isPending ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color={mutedForeground} />
              <Text className="text-base text-muted-foreground">AI 正在思考…</Text>
            </View>
          ) : null}

          {error ? (
            <View className="rounded-2xl border-2 border-risk-l4 bg-risk-l4-tint p-4">
              <Text className="text-lg font-semibold text-risk-l4">咨询没能完成</Text>
              <Text className="mt-1 text-sm leading-5 text-risk-l4">{error}</Text>
              <View className="mt-3 flex-row gap-2">
                {failed ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={retry}
                    disabled={consultMutation.isPending}
                    className="min-h-[44px] flex-1 items-center justify-center rounded-xl bg-primary active:opacity-80"
                  >
                    <Text className="text-base font-medium text-primary-foreground">重试</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setError(null);
                    setFailed(null);
                  }}
                  className="min-h-[44px] flex-1 items-center justify-center rounded-xl border-2 border-risk-l4 active:opacity-80"
                >
                  <Text className="text-base font-medium text-risk-l4">知道了</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View
        className="border-t border-border bg-background px-5 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
        >
          {CONSULT_DATA_QUICK_QUESTIONS.map((q) => (
            <Pressable
              key={q.skillId}
              accessibilityRole="button"
              disabled={consultMutation.isPending}
              onPress={() => handleAsk(q.question, q.skillId)}
              className={cn(
                "min-h-[44px] justify-center rounded-full border border-primary px-4 active:opacity-80",
                consultMutation.isPending && "opacity-50",
              )}
            >
              <Text className="text-sm text-primary">{q.label}</Text>
            </Pressable>
          ))}
          {effectiveDrugId
            ? CONSULT_INSERT_QUICK_QUESTIONS.map((q) => (
                <Pressable
                  key={q.question}
                  accessibilityRole="button"
                  disabled={consultMutation.isPending}
                  onPress={() => handleAsk(q.question, q.skillId)}
                  className={cn(
                    "min-h-[44px] justify-center rounded-full border border-border px-4 active:opacity-80",
                    consultMutation.isPending && "opacity-50",
                  )}
                >
                  <Text className="text-sm text-foreground">{q.label}</Text>
                </Pressable>
              ))
            : null}
        </ScrollView>

        <View className="mt-2 flex-row items-end gap-2">
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder={
              effectiveDrugId ? "输入关于已确认药品的问题…" : "想问什么？直接输入告诉我"
            }
            placeholderTextColor={mutedForeground}
            multiline
            editable={!consultMutation.isPending}
            className={cn(
              "max-h-[120px] min-h-[48px] flex-1 rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground",
              consultMutation.isPending && "opacity-50",
            )}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送"
            disabled={consultMutation.isPending || !question.trim()}
            onPress={() => handleAsk()}
            className={cn(
              "size-12 items-center justify-center rounded-xl bg-primary active:opacity-80",
              (consultMutation.isPending || !question.trim()) && "opacity-50",
            )}
          >
            <Icon as={Send} size={20} color={primaryForeground} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
