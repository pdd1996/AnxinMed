import { Pressable, View } from "react-native";
import {
  Check,
  HeartPulse,
  Info,
  OctagonX,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import { INTERACTION_LEVEL_ORDER, type InteractionLevel } from "@anxin/shared";
import type { confirmDraft, DraftPayload } from "@anxin/core";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/**
 * 规则检查结果区（对齐 web `domain/draft/RiskCards.tsx`）：相互作用卡 + 确认后的结果弹窗。
 * 本片的入口 B 草稿不会有 `dosageRange.issues`（无医嘱用量），`DosageRangeCard` 归 T6-d。
 * 分级色与 web 同源四档，但带 alpha 的 `bg-risk-lN/10` 换成实色 tint（05d §7-7）；
 * 老年向口径：色 + 图标 + 文字三件套，级别中文恒在正文里。
 */

/** confirm 响应（含对**最终确认值**重跑的规则检查）。 */
export type ConfirmResult = Awaited<ReturnType<typeof confirmDraft>>;
type Interaction = NonNullable<DraftPayload["interactions"]>;
type Hit = Interaction["hits"][number];
type DosageRange = NonNullable<DraftPayload["dosageRange"]>;
type Issue = DosageRange["issues"][number];

/** 供其它页面复用的规则检查视图类型（药箱建计划/恢复计划结果弹窗）。 */
export type InteractionView = Interaction;
export type DosageRangeView = DosageRange;

const LEVEL_META: Record<InteractionLevel, { icon: LucideIcon; shell: string }> = {
  禁忌: { icon: OctagonX, shell: "border-risk-l4 bg-risk-l4-tint" },
  慎用: { icon: TriangleAlert, shell: "border-risk-l3 bg-risk-l3-tint" },
  需监测: { icon: HeartPulse, shell: "border-risk-l2 bg-risk-l2-tint" },
  注意: { icon: Info, shell: "border-risk-l2 bg-risk-l2-tint" },
};

function sortedHits(hits: Hit[]): Hit[] {
  return [...(hits ?? [])].sort(
    (a, b) => (INTERACTION_LEVEL_ORDER[b.level] ?? 0) - (INTERACTION_LEVEL_ORDER[a.level] ?? 0),
  );
}

/** 命中条目列表（草稿确认页、计划结果弹窗、常驻安全卡共用同一渲染口径）。 */
export function InteractionHitList({ hits }: { hits: Hit[] }) {
  // 图标颜色必须在渲染顶部取（hook 不能进循环）：三档各读一次 CSS 变量
  const l4 = useUnstableNativeVariable("--risk-l4");
  const l3 = useUnstableNativeVariable("--risk-l3");
  const l2 = useUnstableNativeVariable("--risk-l2");
  const colorOf: Record<InteractionLevel, string | undefined> = {
    禁忌: l4,
    慎用: l3,
    需监测: l2,
    注意: l2,
  };
  return (
    <View className="gap-2">
      {sortedHits(hits).map((hit, i) => {
        const meta = LEVEL_META[hit.level] ?? LEVEL_META["注意"];
        return (
          <View
            key={`${hit.level}-${i}`}
            className={cn("flex-row items-start gap-2 rounded-xl border-2 p-3", meta.shell)}
          >
            <Icon as={meta.icon} size={20} color={colorOf[hit.level] ?? l2} style={{ marginTop: 2 }} />
            <View className="flex-1">
              <Text className="text-sm leading-5 text-foreground">
                <Text className="font-bold">{hit.level} </Text>
                {hit.note}
              </Text>
              {hit.status === "demo" ? (
                <Text className="mt-1 text-xs font-bold text-risk-l3">
                  演示抄录 · 非正式规则库，请以医生/药师意见为准
                </Text>
              ) : null}
              <Text className="mt-1 text-xs leading-5 text-muted-foreground">
                涉及：{(hit.drugNames ?? []).join("、") || "—"} · 来源：{hit.source}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** 相互作用检查结果区（PRD §7.8.2：提示不阻止创建、不自动改方案）。 */
export function InteractionCard({ result }: { result: Interaction | null }) {
  const primary = useUnstableNativeVariable("--primary");
  const ok = useUnstableNativeVariable("--risk-l1");
  const hits = result?.hits ?? [];
  return (
    <Card>
      <CardHeader>
        <View className="flex-row items-center gap-2">
          <Icon as={ShieldCheck} size={20} color={primary} />
          <CardTitle className="text-lg text-card-foreground">相互作用检查</CardTitle>
          <Text className="text-xs text-muted-foreground">对象：本药 × 你当前生效的计划集合</Text>
        </View>
      </CardHeader>
      <CardContent className="gap-2">
        {hits.length > 0 ? (
          <>
            <InteractionHitList hits={hits} />
            <Text className="text-xs leading-5 text-muted-foreground">
              提示不阻止确认、也不会替你改方案 —— 请带着这条提示咨询医生或药师。
            </Text>
          </>
        ) : (
          <View className="flex-row items-start gap-2 rounded-xl border border-border bg-muted p-3">
            <Icon as={ShieldCheck} size={20} color={ok} style={{ marginTop: 2 }} />
            <Text className="flex-1 text-sm leading-5 text-foreground">
              {result?.coverageNote ??
                "当前生效计划集合未见已知相互作用。规则库为演示抄录、覆盖有限，未覆盖不表示无风险。"}
            </Text>
          </View>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 说明书范围校验结果区（T6-d，对齐 web `RiskCards.tsx` 的 DosageRangeCard，PRD §8.3）。
 * pass / exceed / none 三态，仅标注留痕、绝不阻止创建。
 */
export function DosageRangeCard({ result }: { result: DosageRange | null }) {
  const primary = useUnstableNativeVariable("--primary");
  const muted = useUnstableNativeVariable("--muted-foreground");
  const ok = useUnstableNativeVariable("--risk-l1");
  const warn = useUnstableNativeVariable("--risk-l3");
  const status = result?.status ?? "none";
  const issues: Issue[] = result?.issues ?? [];

  return (
    <Card>
      <CardHeader>
        <View className="flex-row flex-wrap items-center gap-2">
          <Icon as={Info} size={20} color={primary} />
          <CardTitle className="text-lg text-card-foreground">说明书范围校验</CardTitle>
          <Text className="text-xs text-muted-foreground">对照说明书库上限 · 仅标注不阻止</Text>
        </View>
      </CardHeader>
      <CardContent>
        {status === "pass" ? (
          <View className="flex-row items-start gap-2 rounded-xl border-2 border-risk-l1 bg-risk-l1-tint p-3">
            <Icon as={Check} size={20} color={ok} style={{ marginTop: 2 }} />
            <Text className="flex-1 text-sm leading-5 text-foreground">
              医嘱在说明书范围内{result?.basis ? `（依据：${result.basis}）` : ""}。
            </Text>
          </View>
        ) : null}
        {status === "exceed" ? (
          <View className="gap-2">
            {issues.map((issue, i) => (
              <View
                key={i}
                className="flex-row items-start gap-2 rounded-xl border-2 border-risk-l3 bg-risk-l3-tint p-3"
              >
                <Icon as={TriangleAlert} size={20} color={warn} style={{ marginTop: 2 }} />
                <Text className="flex-1 text-sm leading-5 text-foreground">
                  <Text className="font-bold">
                    {issue.field === "frequency" ? "频次" : "单次用量"}
                  </Text>
                  {` 处方/填写值 ${issue.planValue} · 说明书上限 ${issue.insertMax}`}
                  {"\n"}
                  <Text className="text-xs text-muted-foreground">{issue.insertNote}</Text>
                </Text>
              </View>
            ))}
            <Text className="text-xs leading-5 text-muted-foreground">
              仅标注留痕、不阻止确认（处方可能有意超说明书用量）。请向开方医生或药师确认后再服用。
              {result?.basis ? ` 依据：${result.basis}` : ""}
            </Text>
          </View>
        ) : null}
        {status === "none" ? (
          <View className="flex-row items-start gap-2 rounded-xl border border-border bg-muted p-3">
            <Icon as={Info} size={20} color={muted} style={{ marginTop: 2 }} />
            <Text className="flex-1 text-sm leading-5 text-foreground">
              {result?.note ?? "说明书库未收录该药的结构化用法用量，本次跳过范围校验（跳过 ≠ 无风险）。"}
            </Text>
          </View>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * 确认成功后的规则检查结果（对**用户最终确认值**重跑）。只在有发现时弹出：
 * 让用户在跳转前真的看到风险；无发现则直接 toast + 跳转（web Draft.tsx:109-114 同口径）。
 * mode='precheck'：入口B 仅建档路径（无计划）——检查对象是「本药 × 当前生效计划集合」（V2.5 入箱预检）。
 */
export function ConfirmResultDialog({
  result,
  drugName,
  onDone,
  mode = "confirm",
}: {
  result: ConfirmResult;
  drugName: string;
  onDone: () => void;
  mode?: "confirm" | "precheck";
}) {
  const precheck = mode === "precheck" ? result.precheck : null;
  const hits =
    mode === "precheck"
      ? precheck?.status === "checked"
        ? precheck.interactions.hits
        : []
      : result.interactions?.hits ?? [];
  const coverageNote =
    mode === "precheck"
      ? precheck?.status === "checked"
        ? precheck.interactions.coverageNote
        : null
      : result.interactions?.coverageNote ?? null;
  const skipped = precheck?.status === "checked" ? precheck.skippedDrugNames : [];
  const issues = mode === "precheck" ? [] : result.dosageRange?.issues ?? [];
  const worst = sortedHits(hits)[0]?.level;
  return (
    <Dialog open onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="max-h-[88vh]">
        <DialogHeader>
          <DialogTitle className="text-xl text-card-foreground">已写入药箱：{drugName}</DialogTitle>
          <DialogDescription className="text-sm leading-5 text-muted-foreground">
            {mode === "precheck"
              ? `已按你当前生效的计划集合检查相互作用${worst ? `，最高级别为「${worst}」` : ""}。提示不阻止、不改方案，请知悉后再用药。`
              : `按你最终确认的值重跑了规则检查${worst ? `，最高级别为「${worst}」` : ""}。提示不阻止、不改方案，请知悉后再用药。`}
          </DialogDescription>
        </DialogHeader>
        <View className="gap-3">
          {hits.length > 0 ? (
            <View className="gap-1">
              <Text className="text-base font-bold text-foreground">
                相互作用（{hits.length} 条）
              </Text>
              <InteractionHitList hits={hits} />
            </View>
          ) : null}
          {issues.length > 0 ? (
            <View className="gap-1">
              <Text className="text-base font-bold text-foreground">
                超出说明书范围（{issues.length} 项）
              </Text>
              {issues.map((issue, i) => (
                <View key={i} className="rounded-xl border-2 border-risk-l3 bg-risk-l3-tint p-2">
                  <Text className="text-sm leading-5 text-foreground">
                    {issue.field === "frequency" ? "频次" : "单次用量"} {issue.planValue} · 上限{" "}
                    {issue.insertMax} —— {issue.insertNote}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {coverageNote && hits.length === 0 ? (
            <Text className="text-xs leading-5 text-muted-foreground">{coverageNote}</Text>
          ) : null}
          {skipped.length > 0 ? (
            <Text className="text-xs leading-5 text-muted-foreground">
              另有 {skipped.length} 个在服药品未关联标准药品库，未参与比对：{skipped.join("、")}。
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={onDone}
            className="min-h-[52px] items-center justify-center rounded-xl bg-primary px-6 active:opacity-80"
          >
            <Text className="text-lg font-semibold text-primary-foreground">我已知悉，去药箱</Text>
          </Pressable>
        </View>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 建计划 / 恢复计划后的规则检查结果弹窗（V2.5：「变更即重跑、结果必须可见」）。
 * 服务端随 createPlan / patchPlan 返回检查结果，前端不得再静默丢弃；只标注不阻止，无发现不弹。
 */
export function RuleCheckAlertDialog({
  open,
  title,
  description,
  result,
  dosageRange,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  result: InteractionView;
  dosageRange?: DosageRangeView | null;
  onClose: () => void;
}) {
  const hits = result.hits ?? [];
  const issues = dosageRange?.issues ?? [];
  if (!open || (hits.length === 0 && issues.length === 0)) return null;
  const worst = sortedHits(hits)[0]?.level;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh]">
        <DialogHeader>
          <DialogTitle className="text-xl text-card-foreground">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-5 text-muted-foreground">
            {description ??
              `已对你当前生效的计划集合重跑规则检查${worst ? `，最高级别为「${worst}」` : ""}。提示不阻止、不改方案，请知悉。`}
          </DialogDescription>
        </DialogHeader>
        <View className="gap-3">
          {hits.length > 0 ? (
            <View className="gap-1">
              <Text className="text-base font-bold text-foreground">
                相互作用（{hits.length} 条）
              </Text>
              <InteractionHitList hits={hits} />
            </View>
          ) : null}
          {issues.length > 0 ? (
            <View className="gap-1">
              <Text className="text-base font-bold text-foreground">
                超出说明书范围（{issues.length} 项）
              </Text>
              {issues.map((issue, i) => (
                <View key={i} className="rounded-xl border-2 border-risk-l3 bg-risk-l3-tint p-2">
                  <Text className="text-sm leading-5 text-foreground">
                    {issue.field === "frequency" ? "频次" : "单次用量"} {issue.planValue} · 上限{" "}
                    {issue.insertMax} —— {issue.insertNote}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {result.coverageNote && hits.length === 0 ? (
            <Text className="text-xs leading-5 text-muted-foreground">{result.coverageNote}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            className="min-h-[52px] items-center justify-center rounded-xl bg-primary px-6 active:opacity-80"
          >
            <Text className="text-lg font-semibold text-primary-foreground">我已知悉</Text>
          </Pressable>
        </View>
      </DialogContent>
    </Dialog>
  );
}
