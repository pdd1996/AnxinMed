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
import { toast } from "sonner-native";
import {
  detectImage,
  initialIntakeFlowState,
  intakeDrug,
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
import { pickFromLibrary, takePhoto } from "@/lib/photo";
import { API_URL_MISSING_HINT, isApiConfigured } from "@/lib/wiring";

/**
 * 录入骨架（M5-T4 · 05c 执行书）——**最细一条线**：拍照 → 层检测 → 识别 → 草稿确认 → 药箱。
 *
 * 分工与 web 端 `IntakeFlow.tsx` 完全一致（这是 M5-T2 抽包的意义）：
 *   - 决策全在 core 的 `transitionIntakeFlow`（纯函数、已单测），本文件只是**动作解释器 + 渲染**；
 *   - 平台差异收在四处：取图（expo-image-picker 直出 base64，替代 web 的 FileReader）、
 *     像素预检（一期降级为「不预检」，见下方 compute_stats 分支）、提示（sonner-native）、
 *     跳转（expo-router）。
 *
 * 范围纪律（05c「明确不做」）：入口 A（拍处方笺）留 T6、五页全量移植留 T5、提醒留 T8。
 */

const ENTRY: IntakeEntry = "B";
const STAGES = STAGE_TEXT[ENTRY];

const PRESSABLE_CLASS =
  "min-h-[52px] items-center justify-center rounded-xl px-4 py-3";

export default function Intake() {
  const router = useRouter();
  const [state, setState] = useState<IntakeFlowState>(initialIntakeFlowState);
  // 异步回调要读到最新状态（而非发起时的闭包值）；状态只经 dispatch 写入，故 ref 与 state 同源。
  const stateRef = useRef(state);
  const configured = isApiConfigured();

  const ctx: IntakeFlowCtx = {
    entry: ENTRY,
    otherEntryPath: "/intake",
    stageCount: STAGES.length,
  };

  /** 执行 core 决策产出的动作（本端副作用；结果再以事件回灌状态机）。 */
  function runActions(actions: IntakeFlowAction[]) {
    for (const action of actions) {
      switch (action.type) {
        case "toast":
          toast.error(action.message);
          break;

        /**
         * 质量预检：05 任务书 T2/T4 明确允许移动端一期降级——
         * 预检本身只是「建议不拦用户」，core 收到 `stats: null` 即视为无问题、主流程照走。
         * 二期用 expo-image-manipulator / 像素统计补实现时，只需在这里换成真实统计值。
         */
        case "compute_stats":
          void Promise.resolve(null).then((stats) =>
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
            () => intakeDrug(action.dataUrl),
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
          if (path === "/box") {
            // 手动建档表单属 T5 范围：不藏按钮语义，也不假装完成——明示去处与缺口。
            toast.info("手动建档表单将在 M5-T5 接入安卓端，本次先到药箱");
            router.push("/box" as Href);
            return;
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

  // 处理中阶段文案推进（PRD §10.1「处理中状态明确」）；下标归零由状态机负责。
  useEffect(() => {
    if (state.step !== "processing") return;
    const timer = setInterval(() => dispatch({ type: "stage_tick" }), 900);
    return () => clearInterval(timer);
  }, [state.step]);

  async function start(source: "camera" | "library") {
    const picked = source === "camera" ? await takePhoto() : await pickFromLibrary();
    if (picked.ok) {
      dispatch({ type: "file_read", dataUrl: picked.photo.dataUrl });
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
      <Text className="mt-1 text-2xl font-bold text-foreground">拍药盒 · 建档案</Text>

      {!configured && (
        <View className="mt-4 rounded-2xl border border-risk-l4 bg-risk-l4-tint p-4">
          <Text className="text-base font-semibold text-risk-l4">还没配好服务器地址</Text>
          <Text className="mt-1 text-sm leading-5 text-risk-l4">{API_URL_MISSING_HINT}</Text>
        </View>
      )}

      {state.step === "upload" && (
        <View className="mt-5 gap-3">
          <View className="items-center rounded-2xl border-2 border-dashed border-border bg-muted/40 p-6">
            <Text className="text-lg font-semibold text-foreground">
              把药盒正面拍清楚
            </Text>
            <Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">
              对准药盒上的药名与规格，让文字占满画面；关闭闪光灯，避开反光。
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
        <StepCard title="照片质量可能影响识别">
          {state.issues.map((issue) => (
            <Text key={issue} className="mt-1 text-sm leading-5 text-foreground">
              · {issue}
            </Text>
          ))}
          <ActionRow>
            <SecondaryButton label="重拍 / 换一张" onPress={() => dispatch({ type: "retake" })} />
            <PrimaryButton label="仍要上传" onPress={() => dispatch({ type: "retry" })} />
          </ActionRow>
        </StepCard>
      )}

      {state.step === "processing" && (
        <StepCard title={`正在识别（${ENTRY === "A" ? "处方笺" : "药盒"}）`} spinning>
          {state.image ? (
            <Image
              source={{ uri: state.image }}
              resizeMode="contain"
              style={{ width: "100%", height: 220, borderRadius: 12 }}
              accessibilityLabel="待识别照片"
            />
          ) : null}
          <View className="mt-4 gap-2">
            {STAGES.map((stage, i) => (
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
          <Text className="text-base leading-6 text-foreground">
            {state.mismatch.suggestion}
          </Text>
          <LayerBadges layers={state.mismatch.detected} />
          <Text className="mt-2 text-xs leading-5 text-muted-foreground">
            系统只核对照片与所选入口是否一致，不会自己换路径。服务端也会拦，按当前入口继续通常仍会被拒绝。安卓端「拍处方笺」入口在 M5-T6 接入，本次可重拍药盒或按当前入口重试。
          </Text>
          <ActionRow>
            <SecondaryButton label="重新上传" onPress={() => dispatch({ type: "retake" })} />
            <PrimaryButton
              label="检测错了 · 按当前入口重试"
              onPress={() => dispatch({ type: "retry" })}
            />
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
          </ActionRow>
          {state.feedback.allowSwitch && (
            <Text className="mt-2 text-xs text-muted-foreground">
              换到「拍处方笺」重跑：安卓端在 M5-T6 接入。
            </Text>
          )}
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
}: {
  title: string;
  children: ReactNode;
  tone?: "danger";
  spinning?: boolean;
}) {
  return (
    <View
      className={`mt-5 rounded-2xl border p-5 ${
        tone === "danger" ? "border-risk-l4 bg-risk-l4-tint" : "border-border bg-card"
      }`}
    >
      <View className="flex-row items-center gap-2">
        {spinning && <ActivityIndicator />}
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
