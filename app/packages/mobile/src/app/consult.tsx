import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUnstableNativeVariable } from "nativewind";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertTriangle, History, MessageSquarePlus, Send } from "lucide-react-native";
import {
  CONFIRM_STATUS_META,
  CONSULT_DATA_QUICK_QUESTIONS,
  CONSULT_INSERT_QUICK_QUESTIONS,
  type ConsultSkillId,
  type ConsultSuggestion,
} from "@anxin/shared";
import {
  fetchConsultSession,
  fetchConsultSessions,
  fetchDrugs,
  postConsult,
  type ConsultResponseDto,
  type ConsultSessionDetailDto,
} from "@anxin/core";
import { guardRequest, TIMEOUT_MS } from "@/lib/net";
import { AnswerCard, buildSpeakText } from "@/components/domain/consult/AnswerCard";
import { EmergencyCard } from "@/components/domain/consult/EmergencyCard";
import { SuggestionCard } from "@/components/domain/consult/SuggestionCard";
import { SpeakButton } from "@/components/domain/voice/SpeakButton";
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

/** 会话时间展示（老年向：月日 + 时分，不用 ISO 串；照 web `formatTime`）。 */
function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/** 会话回放行 → 聊天消息对（照 web `logToChatMessages`；卡片只在其产生的一轮有效，回放不重弹）。 */
function logToChatMessages(
  log: ConsultSessionDetailDto["messages"][number],
): ChatMessage[] {
  const snapshot = (log.sectionsSnapshot ?? null) as ConsultResponseDto["sections"];
  const response: ConsultResponseDto = {
    riskLevel: log.riskLevel,
    status: log.status,
    answer: snapshot?.summary ?? log.question,
    sections: snapshot,
    citations: (log.citations ?? null) as ConsultResponseDto["citations"],
    notice: log.notice,
    l0Notice: null,
    blocked: log.blockedAt != null,
    toolUsed: log.status === "data-answered" ? log.intent : null,
    consultLogId: log.consultLogId,
    sessionId: "",
    suggestion: null,
  };
  return [
    { id: `${log.consultLogId}-q`, role: "user", question: log.question },
    { id: log.consultLogId, role: "assistant", response },
  ];
}

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
  const queryClient = useQueryClient();
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ text: string; skillId?: ConsultSkillId } | null>(
    null,
  );
  const scrollRef = useRef<ScrollView>(null);
  // 最新一条回答（头部播报对象；卡内不重复放播放按钮，照 web 2026-09-21 改版）
  const lastResponse = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.response)?.response;

  const sessionsQuery = useQuery({
    queryKey: ["consult-sessions"],
    queryFn: async () => {
      const result = await guardRequest(
        () => fetchConsultSessions(),
        TIMEOUT_MS.consult,
      );
      if (!result.ok) throw new Error(result.message);
      return result.data;
    },
    enabled: historyOpen,
  });

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

  /** 回放历史会话：拉详情 → 映射消息 → 会话续接到当前窗口（照 web `handleRestoreSession`）。 */
  const restoreSession = async (id: string) => {
    if (historyBusyId) return;
    setHistoryBusyId(id);
    setHistoryError(null);
    const result = await guardRequest(
      () => fetchConsultSession(id),
      TIMEOUT_MS.consult,
    );
    setHistoryBusyId(null);
    if (!result.ok) {
      setHistoryError(result.message);
      return;
    }
    setSessionId(result.data.session.id);
    setMessages(result.data.messages.flatMap(logToChatMessages));
    setSuggestion(null);
    setError(null);
    setFailed(null);
    setHistoryOpen(false);
  };

  /** 开新会话：清空本地会话态（服务端历史保留，可从「历史会话」再进入）。 */
  const handleNewSession = () => {
    setSessionId(null);
    setMessages([]);
    setSuggestion(null);
    setError(null);
    setFailed(null);
    setHistoryOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["consult-sessions"] });
  };

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-4 flex-row items-center gap-2">
          <SpeakButton
            text={
              lastResponse
                ? buildSpeakText(
                    lastResponse.sections ?? null,
                    lastResponse.answer,
                    lastResponse.notice,
                  )
                : ""
            }
            label="播放最新回答"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: historyOpen }}
            onPress={() => {
              setHistoryError(null);
              setHistoryOpen((v) => !v);
            }}
            className={cn(
              "min-h-[44px] flex-row items-center gap-1.5 rounded-xl border border-border px-3 active:opacity-80",
              historyOpen && "bg-secondary",
            )}
          >
            <Icon as={History} size={18} color={mutedForeground} />
            <Text
              className={cn(
                "text-sm font-medium",
                historyOpen ? "text-secondary-foreground" : "text-foreground",
              )}
            >
              历史会话
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={handleNewSession}
            className="min-h-[44px] flex-row items-center gap-1.5 rounded-xl border border-border px-3 active:opacity-80"
          >
            <Icon as={MessageSquarePlus} size={18} color={mutedForeground} />
            <Text className="text-sm font-medium text-foreground">开新会话</Text>
          </Pressable>
        </View>

        {historyOpen ? (
          <View className="mb-4 rounded-xl border border-border bg-muted p-2">
            {sessionsQuery.isPending ? (
              <Text className="p-2 text-sm text-muted-foreground">加载中…</Text>
            ) : sessionsQuery.error ? (
              <Text className="p-2 text-sm leading-5 text-risk-l4">
                {sessionsQuery.error instanceof Error
                  ? sessionsQuery.error.message
                  : "历史会话读取失败，请重试。"}
              </Text>
            ) : (sessionsQuery.data?.items.length ?? 0) === 0 ? (
              <Text className="p-2 text-sm text-muted-foreground">还没有历史会话。</Text>
            ) : (
              <View className="gap-1">
                {(sessionsQuery.data?.items ?? []).map((s) => (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    disabled={!!historyBusyId}
                    onPress={() => void restoreSession(s.id)}
                    className="min-h-[44px] flex-row items-center gap-2 rounded-lg px-2 py-2 active:opacity-80"
                  >
                    <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
                      {s.title}
                    </Text>
                    <Text className="shrink-0 text-xs text-muted-foreground">
                      {formatTime(s.lastActiveAt)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {historyBusyId ? (
              <Text className="p-2 text-sm text-muted-foreground">正在打开会话…</Text>
            ) : null}
            {historyError ? (
              <Text className="p-2 text-sm leading-5 text-risk-l4">{historyError}</Text>
            ) : null}
          </View>
        ) : null}

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

      <KeyboardStickyView>
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
      </KeyboardStickyView>
    </View>
  );
}
