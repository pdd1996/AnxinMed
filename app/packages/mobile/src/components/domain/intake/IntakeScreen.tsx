import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, useRouter, type Href } from "expo-router";
import { FileText, Package, TriangleAlert } from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { toast } from "sonner-native";
import {
  detectImage,
  initialIntakeFlowState,
  intakeDrug,
  intakePrescription,
  QUALITY_HINTS,
  QUALITY_ISSUE_LABEL,
  SAFETY_NOTE,
  STAGE_TEXT,
  transitionIntakeFlow,
  useIntakeSession,
  type Entry as IntakeEntry,
  type IntakeFlowAction,
  type IntakeFlowCtx,
  type IntakeFlowEvent,
  type IntakeFlowState,
} from "@anxin/core";
import { callTransport, TIMEOUT_MS } from "@/lib/net";
import { computeImageStats } from "@/lib/imageStats";
import { pickFromLibrary, takePhoto } from "@/lib/photo";
import { API_URL_MISSING_HINT, isApiConfigured } from "@/lib/wiring";

/**
 * 录入屏（M5-T6a · 双入口平级 tab；M5-T6b · 本地质量预检）：处方笺（A）/ 药盒（B）两个路由各挂一份本组件。
 * 对齐 web `IntakeFlow.tsx` 的 09-25 改造口径——tab 只在 upload 步渲染（照片进流程后收起）、
 * 点另一颗即切（无确认弹窗，RN 用 replace 实现对方页重挂的「上传态归零」语义）、眉题「拍照录入」常驻。
 * 分工不变：决策全在 core 的 `transitionIntakeFlow`（纯函数、已单测），本组件只是动作解释器 + 渲染。
 * 平台差异四处：取图（expo-image-picker）、像素预检（`@/lib/imageStats`：原生缩放 + JS 解码）、
 * 提示（sonner-native）、跳转（expo-router，跨入口 replace）。
 */

interface IntakeCopy {
  entry: IntakeEntry;
  pageTitle: string;
  uploadTitle: string;
  uploadHint: string;
  otherEntryLabel: string;
  otherEntryPath: string;
}

/** 逐字照搬 web 的入口文案（IntakeRx.tsx / IntakeDrug.tsx），禁新写话术（05e §2-T6-a-2）。 */
const COPY: Record<IntakeEntry, IntakeCopy> = {
  A: {
    entry: "A",
    pageTitle: "拍处方笺录入",
    uploadTitle: "上传平铺完整的处方笺照片",
    uploadHint: "单子摊平拍全，光线足、别反光",
    otherEntryLabel: "拍药品",
    otherEntryPath: "/intake/drug",
  },
  B: {
    entry: "B",
    pageTitle: "拍药品建档",
    uploadTitle: "上传正面清晰的药盒照片",
    uploadHint: "药盒正面拍清楚；散装药片拍不了",
    otherEntryLabel: "拍处方笺",
    otherEntryPath: "/intake/rx",
  },
};

const ENTRY_TABS: { entry: IntakeEntry; label: string; icon: typeof FileText }[] = [
  { entry: "A", label: "拍处方笺", icon: FileText },
  { entry: "B", label: "拍药品", icon: Package },
];

const PRESSABLE_CLASS =
  "min-h-[52px] items-center justify-center rounded-xl px-4 py-3";

export default function IntakeScreen({ entry }: { entry: IntakeEntry }) {
  const router = useRouter();
  const copy = COPY[entry];
  const [state, setState] = useState<IntakeFlowState>(initialIntakeFlowState);
  // 异步回调要读到最新状态（而非发起时的闭包值）；状态只经 dispatch 写入，故 ref 与 state 同源。
  const stateRef = useRef(state);
  const configured = isApiConfigured();
  // 图标不吃 TextClassContext，颜色显式给（05d §7-7）。
  const iconFg = useUnstableNativeVariable("--primary-foreground");
  const iconMuted = useUnstableNativeVariable("--muted-foreground");

  const ctx: IntakeFlowCtx = {
    entry,
    otherEntryPath: copy.otherEntryPath,
    stageCount: STAGE_TEXT[entry].length,
  };

  /** 执行 core 决策产出的动作（本端副作用；结果再以事件回灌状态机）。 */
  function runActions(actions: IntakeFlowAction[]) {
    for (const action of actions) {
      switch (action.type) {
        case "toast":
          toast.error(action.message);
          break;

        /**
         * 本地质量预检（M5-T6b）：原生缩放 + JS 解码出统计值，判读仍由 core 做。
         * `stats: null` = 这台机器上这次拿不到统计值 → core 视为「无问题」，主流程照走。
         * 预检只是建议，任何时候都不拦用户（05e §0-1）。
         */
        case "compute_stats":
          void computeImageStats(action.dataUrl, action.source).then((stats) =>
            dispatch({ type: "stats_checked", stats }),
          );
          break;

        case "detect":
          void callTransport(
            () => detectImage(action.dataUrl, action.entry),
            TIMEOUT_MS.detect,
          ).then((det) => {
            if (!det.ok) {
              dispatch({ type: "detect_failed", failure: det });
              return;
            }
            dispatch({
              type: "detect_ok",
              dataUrl: action.dataUrl,
              layers: det.data.layers,
              unsupported: det.data.unsupported,
              mismatch: det.data.mismatch,
            });
          });
          break;

        case "intake":
          void callTransport(
            () =>
              action.entry === "A"
                ? intakePrescription(action.dataUrl)
                : intakeDrug(action.dataUrl),
            TIMEOUT_MS.intake,
          ).then((res) => {
            if (!res.ok) {
              dispatch({ type: "intake_failed", failure: res });
              return;
            }
            dispatch({ type: "intake_ok", dataUrl: action.dataUrl, result: res.data });
          });
          break;

        case "session_set_images":
          useIntakeSession.getState().setSession(action.draftIds, action.dataUrl);
          break;

        case "session_set_pending_image":
          useIntakeSession.getState().setPendingImage(action.pending);
          break;

        case "session_clear_pending_image":
          useIntakeSession.getState().setPendingImage(null);
          break;

        case "navigate": {
          const [path] = action.path.split("?");
          // 跨入口切换 = 点按即切（05e §0-4）：replace 不留栈，对方屏重挂即干净的上传态（与 web 换页同语义）。
          if (path.startsWith("/intake/")) {
            router.replace(action.path as Href);
            break;
          }
          router.push(action.path as Href);
          break;
        }
      }
    }
  }

  /** 单步迁移：core 决策（纯）→ 落状态 → 执行动作。setState 保持纯净，副作用只在这里同步跑一次。 */
  function dispatch(event: IntakeFlowEvent) {
    const next = transitionIntakeFlow(stateRef.current, event, ctx);
    stateRef.current = next.state;
    setState(next.state);
    runActions(next.actions);
  }

  // 层检测纠偏的跨入口交接：对方入口页留下原图时，本页直接重跑（web IntakeFlow.tsx:151-154 同语义）。
  // 仅挂载时跑一次；dispatch 闭包读到的是 ref 里的最新状态，故意不进依赖。
  useEffect(() => {
    dispatch({ type: "handoff", pending: useIntakeSession.getState().pendingImage });
  }, []);

  // 处理中阶段文案推进（PRD §10.1「处理中状态明确」）；下标归零由状态机负责。
  useEffect(() => {
    if (state.step !== "processing") return;
    const timer = setInterval(() => dispatch({ type: "stage_tick" }), 900);
    return () => clearInterval(timer);
  }, [state.step]);

  async function start(from: "camera" | "library") {
    const picked = from === "camera" ? await takePhoto() : await pickFromLibrary();
    if (picked.ok) {
      const { dataUrl, uri, width, height } = picked.photo;
      // uri 与原图边长只服务本机预检（05e §1-3）：下传的仍是 dataUrl，预检不改变上传内容
      dispatch({ type: "file_read", dataUrl, source: { uri, width, height } });
      return;
    }
    if (picked.kind === "cancelled") return;
    dispatch({ type: "file_rejected", message: picked.message });
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: 16 }}
    >
      <Text className="text-xs font-bold uppercase tracking-[2px] text-primary">
        拍照录入
      </Text>
      <Text className="mt-1 text-2xl font-bold text-foreground">{copy.pageTitle}</Text>

      {!configured && (
        <View className="mt-4 rounded-2xl border border-risk-l4 bg-risk-l4-tint p-4">
          <Text className="text-base font-semibold text-risk-l4">还没配好服务器地址</Text>
          <Text className="mt-1 text-sm leading-5 text-risk-l4">{API_URL_MISSING_HINT}</Text>
        </View>
      )}

      {state.step === "upload" && (
        <View className="mt-5 gap-3">
          {/* 平级 tab：只在 upload 步出现（照片进流程后收起）；选中态 = 描边 + 实底 + 图标，不单靠颜色 */}
          <View className="flex-row gap-2">
            {ENTRY_TABS.map((tab) => {
              const active = tab.entry === entry;
              return (
                <Pressable
                  key={tab.entry}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  disabled={active}
                  onPress={() => dispatch({ type: "goto_other_entry" })}
                  className={`h-14 flex-1 flex-row items-center justify-center gap-2 rounded-xl border active:opacity-80 ${
                    active ? "border-primary bg-primary" : "border-border bg-card"
                  }`}
                >
                  <tab.icon size={20} color={active ? iconFg : iconMuted} importantForAccessibility="no" />
                  <Text
                    className={`text-base font-semibold ${
                      active ? "text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View className="items-center rounded-2xl border-2 border-dashed border-border bg-muted p-6">
            <Text className="text-lg font-semibold text-foreground">{copy.uploadTitle}</Text>
            <Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">
              {copy.uploadHint}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={!configured}
            onPress={() => void start("camera")}
            className={`${PRESSABLE_CLASS} bg-primary active:opacity-80 ${
              configured ? "" : "opacity-50"
            }`}
          >
            <Text className="text-lg font-medium text-primary-foreground">拍照</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!configured}
            onPress={() => void start("library")}
            className={`${PRESSABLE_CLASS} rounded-xl border border-border bg-card active:opacity-80 ${
              configured ? "" : "opacity-50"
            }`}
          >
            <Text className="text-lg font-medium text-card-foreground">从相册选一张</Text>
          </Pressable>
          <Text className="mt-1 text-xs leading-5 text-muted-foreground">
            上传即表示你了解图片可能包含个人健康信息。原图只存在本机会话内存里；服务端只取与用药有关的字段，姓名、门诊号这类信息在发送前就被去掉，原文用完即弃、不存图片字节。
          </Text>
        </View>
      )}

      {state.step === "quality" && (
        <StepCard title="照片质量可能影响识别" warn>
          {/* 逐字走 core 的标签与话术（05e §2-T6-b-3：阈值与文案零新增）；底色/描边用 L3 实色令牌，
              正文用 --foreground——与下方 SAFETY_NOTE 同一档对比度口径（README 的 /alpha 禁写条） */}
          <View className="gap-2">
            {state.issues.map((issue) => (
              <View key={issue} className="rounded-xl border border-risk-l3 bg-risk-l3-tint p-3">
                <Text className="text-sm leading-5 text-foreground">
                  <Text className="font-semibold">{QUALITY_ISSUE_LABEL[issue]}：</Text>
                  {QUALITY_HINTS[issue]}
                </Text>
              </View>
            ))}
          </View>
          {/* 两端分叉的唯一一处措辞：web 说「浏览器本地」，RN 说「本机」（05e §2-T6-b-4） */}
          <Text className="mt-1 text-xs leading-5 text-muted-foreground">
            这是本机上的拍照建议（不上传、不做识别判断）。质量差时识别会降级为人工补，不会编造。
          </Text>
          <ActionRow>
            <SecondaryButton label="重拍 / 换一张" onPress={() => dispatch({ type: "retake" })} />
            <PrimaryButton label="仍要上传" onPress={() => dispatch({ type: "retry" })} />
          </ActionRow>
        </StepCard>
      )}

      {state.step === "processing" && (
        <StepCard title={`正在识别（${entry === "A" ? "处方笺" : "药品"}）`} spinning>
          {state.image ? (
            <Image
              source={{ uri: state.image }}
              resizeMode="contain"
              style={{ width: "100%", height: 220, borderRadius: 12 }}
              accessibilityLabel="待识别照片"
            />
          ) : null}
          <View className="mt-4 gap-2">
            {STAGE_TEXT[entry].map((stage, i) => (
              <View key={stage} className="flex-row items-center gap-2">
                {i < state.stageIdx ? (
                  <Text className="text-base text-risk-l1">✓</Text>
                ) : i === state.stageIdx ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text className="text-base text-muted-foreground">·</Text>
                )}
                <Text
                  className={
                    i === state.stageIdx
                      ? "flex-1 text-base font-semibold text-foreground"
                      : "flex-1 text-base text-muted-foreground"
                  }
                >
                  {stage}
                </Text>
              </View>
            ))}
          </View>
        </StepCard>
      )}

      {state.step === "mismatch" && state.mismatch && (
        <StepCard title="检测结果与所选入口不符">
          {state.handoffNote ? (
            <Text className="text-sm leading-5 text-muted-foreground">{state.handoffNote}</Text>
          ) : null}
          <Text className="text-base leading-6 text-foreground">
            {state.mismatch.suggestion}
          </Text>
          <LayerBadges layers={state.mismatch.detected} />
          <Text className="mt-2 text-xs leading-5 text-muted-foreground">
            系统只核对照片与所选入口是否一致，不会自己换路径。服务端也会拦，按当前入口继续通常仍会被拒绝。
          </Text>
          <ActionRow>
            <PrimaryButton
              label={`切换到「${copy.otherEntryLabel}」重跑`}
              onPress={() => dispatch({ type: "switch_entry" })}
            />
            <SecondaryButton
              label="检测错了 · 按当前入口重试"
              onPress={() => dispatch({ type: "retry" })}
            />
            <SecondaryButton label="重新上传" onPress={() => dispatch({ type: "retake" })} />
          </ActionRow>
        </StepCard>
      )}

      {state.step === "failure" && state.feedback && (
        <StepCard title={state.feedback.title} tone="danger">
          <Text className="text-base leading-6 text-foreground">
            {state.feedback.body}
          </Text>
          <LayerBadges layers={state.feedback.detected} />
          <View className="mt-2 gap-1">
            {state.feedback.hints.map((hint) => (
              <Text key={hint} className="text-sm leading-5 text-muted-foreground">
                · {hint}
              </Text>
            ))}
          </View>
          {/* 告警卡：底色/描边走 L3 令牌（深浅两档都有值），正文用 --foreground——
              text-risk-l3 压在 risk-l3-tint 上只有约 3.3:1，够不上老年向的正读对比。 */}
          <View className="mt-3 rounded-xl border border-risk-l3 bg-risk-l3-tint p-3">
            <Text className="text-sm leading-5 text-foreground">{SAFETY_NOTE}</Text>
          </View>
          <ActionRow>
            <SecondaryButton label="重新上传" onPress={() => dispatch({ type: "retake" })} />
            {state.feedback.kind === "unavailable" && (
              <PrimaryButton label="重试" onPress={() => dispatch({ type: "retry" })} />
            )}
            {state.feedback.allowManual && (
              <SecondaryButton
                label="手动建档（不经识别）"
                onPress={() => dispatch({ type: "goto_manual" })}
              />
            )}
            {state.feedback.allowSwitch && (
              <SecondaryButton
                label={`换到「${copy.otherEntryLabel}」`}
                onPress={() => dispatch({ type: "goto_other_entry" })}
              />
            )}
          </ActionRow>
        </StepCard>
      )}

      {state.step === "drafts" && state.result && (
        <StepCard title={`识别完成：${state.result.drafts.length} 份草稿待确认`}>
          <Text className="text-sm leading-5 text-muted-foreground">
            一张处方笺含多个药品时会拆成多份「档案 + 计划」草稿；确认页要一份一份人工核对。
          </Text>
          {state.result.drafts.map((draft, i) => (
            <Pressable
              key={draft.id}
              accessibilityRole="button"
              onPress={() => dispatch({ type: "open_draft", draftId: draft.id })}
              className="mt-3 min-h-[60px] justify-between rounded-xl border border-border bg-background p-4 active:opacity-80"
            >
              <Text className="text-lg font-semibold text-foreground">
                {draft.drugName || `条目 ${i + 1}`}
              </Text>
              <Text className="mt-1 text-sm text-muted-foreground">去确认 →</Text>
            </Pressable>
          ))}
          <ActionRow>
            <SecondaryButton label="再传一张" onPress={() => dispatch({ type: "retake" })} />
          </ActionRow>
        </StepCard>
      )}

      <Stack.Screen options={{ title: "拍照录入" }} />
    </ScrollView>
  );
}

// ── 本文件内的最简呈现件（T5 换 RNR 组件 + fontScale 全量移植）──

function StepCard({
  title,
  children,
  tone,
  spinning,
  warn,
}: {
  title: string;
  children: ReactNode;
  tone?: "danger";
  spinning?: boolean;
  /** 标题前挂告警三角（web 的质量卡形态）；卡本身保持中性底色，只有失败卡才是红底。 */
  warn?: boolean;
}) {
  const warnColor = useUnstableNativeVariable("--risk-l3");
  return (
    <View
      className={`mt-5 rounded-2xl border p-5 ${
        tone === "danger" ? "border-risk-l4 bg-risk-l4-tint" : "border-border bg-card"
      }`}
    >
      <View className="flex-row items-center gap-2">
        {spinning && <ActivityIndicator />}
        {warn && (
          <TriangleAlert size={20} color={warnColor} importantForAccessibility="no" />
        )}
        <Text
          className={`flex-1 text-xl font-bold ${
            tone === "danger" ? "text-risk-l4" : "text-card-foreground"
          }`}
        >
          {title}
        </Text>
      </View>
      <View className="mt-3 gap-1">{children}</View>
    </View>
  );
}

function LayerBadges({ layers }: { layers: string[] }) {
  if (layers.length === 0) return null;
  return (
    <View className="mt-2 flex-row flex-wrap gap-2">
      {layers.map((layer) => (
        <View
          key={layer}
          className="rounded-full bg-secondary px-3 py-1"
        >
          <Text className="text-xs font-semibold text-secondary-foreground">{layer}</Text>
        </View>
      ))}
    </View>
  );
}

function ActionRow({ children }: { children: ReactNode }) {
  return <View className="mt-4 gap-2">{children}</View>;
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`${PRESSABLE_CLASS} bg-primary active:opacity-80`}
    >
      <Text className="text-lg font-medium text-primary-foreground">{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`${PRESSABLE_CLASS} border border-border bg-card active:opacity-80`}
    >
      <Text className="text-lg font-medium text-card-foreground">{label}</Text>
    </Pressable>
  );
}
