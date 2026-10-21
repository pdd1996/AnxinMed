import { useState, type ReactNode } from "react";
import { Image, Pressable, View } from "react-native";
import {
  AlertTriangle,
  Check,
  FileText,
  ImageOff,
  Lock,
  type LucideIcon,
} from "lucide-react-native";
import { useUnstableNativeVariable } from "nativewind";
import type { DraftPayload } from "@anxin/core";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

/**
 * 原文对照面板（对齐 web `domain/draft/OriginalPanel.tsx`，PRD §10.2 第 1 条 / §7.2.5）。
 * 三张卡逐块照搬：原文对照（原图 ↔ 文字原文）、隐私处理（四步程序）、照片类型（层检测 + 贴标提示）。
 *
 * 与 web 的两处刻意差异，都属两端分叉、不回改 web：
 *   ① 尾句「原图仅在本次会话的**浏览器**内存中显示」在 RN 落「**本机**内存」；
 *   ② 带 alpha 的 `border-risk-l3/40 bg-risk-l3/10` 一族在 RN 整条不落产物，换成实色 `*-tint` +
 *      `text-foreground` 正文（同 05d §7-7、05e §2-T6-b 那条口径）。
 */

/** 人工补清单 → 中文标签 + 该行原文（缺失时明确说「原文缺失」，绝不编造）。 */
const NEED_META: Record<string, { label: string; original: (p: DraftPayload) => string }> = {
  drugName: { label: "药名", original: (p) => p.item?.drugName || "（原文未识别到该行）" },
  genericName: { label: "药名", original: (p) => p.identity?.genericName || "（原文未识别到该行）" },
  specification: {
    label: "规格",
    original: (p) => p.item?.specification || p.identity?.specification || "（原文缺失或被涂黑）",
  },
  form: { label: "剂型", original: (p) => p.identity?.form || "（原文缺失或被涂黑）" },
  quantity: { label: "数量", original: (p) => p.item?.quantity || "（原文缺失或被涂黑）" },
  usage: { label: "用法用量", original: (p) => p.item?.usage || "（原文该行缺失或被涂黑）" },
  date: { label: "处方日期", original: (p) => p.whitelist?.date || "（原文缺失或被涂黑）" },
  hospital: { label: "医院", original: (p) => p.whitelist?.hospital || "（原文缺失或被涂黑）" },
  items: { label: "处方条目", original: () => "（未定位到处方正文条目）" },
};

/** 左标签右取值的对照行（web 的 `dl` 行在 RN 用一行 flex 承载）。 */
function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="max-w-[62%] text-right text-sm font-semibold text-foreground">
        {value || "—"}
      </Text>
    </View>
  );
}

function SubTitle({ children }: { children: string }) {
  return (
    <Text className="mt-4 text-xs font-bold uppercase tracking-[1px] text-muted-foreground">
      {children}
    </Text>
  );
}

function TintNote({ icon: IconCmp, children }: { icon: LucideIcon; children: ReactNode }) {
  const warn = useUnstableNativeVariable("--risk-l3");
  return (
    <View className="mt-3 flex-row items-start gap-2 rounded-xl border-2 border-risk-l3 bg-risk-l3-tint p-3">
      <Icon as={IconCmp} size={20} color={warn} style={{ marginTop: 2 }} />
      <Text className="flex-1 text-sm leading-5 text-foreground">{children}</Text>
    </View>
  );
}

export function OriginalPanel({
  payload,
  imageUrl,
}: {
  payload: DraftPayload;
  imageUrl?: string;
}) {
  const [zoom, setZoom] = useState(false);
  const primary = useUnstableNativeVariable("--primary");
  const w = payload.whitelist ?? null;
  const audit = payload.sanitizeAudit ?? {};
  const auditHits = Object.entries(audit).filter(([, n]) => n > 0);
  const needs = payload.needsManual ?? [];

  return (
    <View className="gap-4">
      <Card>
        <CardHeader>
          <View className="flex-row items-center gap-2">
            <Icon as={FileText} size={20} color={primary} />
            <CardTitle className="text-lg text-card-foreground">原文对照</CardTitle>
            <Text className="text-xs text-muted-foreground">
              原文 ↔ 结构化字段，逐项扫读核对
            </Text>
          </View>
        </CardHeader>
        <CardContent className="gap-3">
          {imageUrl ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="点开原图，放大核对"
              onPress={() => setZoom(true)}
              className="active:opacity-80"
            >
              <Image
                source={{ uri: imageUrl }}
                resizeMode="contain"
                style={{ width: "100%", height: 240, borderRadius: 12 }}
                accessibilityLabel="识别原图"
              />
            </Pressable>
          ) : (
            <TintNote icon={ImageOff}>
              本次会话已无原图（原图只在内存中即用即弃，离开本页即丢弃）。请对照下方文字原文核对；
              如需看图核对，请返回录入页重新拍摄。
            </TintNote>
          )}

          {payload.item ? (
            <View className="mt-1 gap-1 rounded-xl border border-border bg-background p-3">
              <SubTitle>本条目原文（只留用药相关几类）</SubTitle>
              <Row label="药名" value={payload.item.drugName} />
              <Row label="规格" value={payload.item.specification} />
              <Row label="数量" value={payload.item.quantity} />
              <Row label="用法原文行" value={payload.item.usage} />
            </View>
          ) : null}

          {w ? (
            <View className="mt-1 gap-1">
              <SubTitle>处方头部（只留固定几类）</SubTitle>
              <Row label="医院" value={w.hospital} />
              <Row label="处方号" value={w.prescriptionNo} />
              <Row label="日期" value={w.date} />
              <Row label="科室" value={w.department} />
              <Row label="诊断" value={w.diagnosis} />
            </View>
          ) : null}

          {needs.length > 0 ? (
            <View className="mt-1 gap-2 rounded-xl border-2 border-risk-l3 bg-risk-l3-tint p-3">
              <View className="flex-row items-start gap-2">
                <Icon as={AlertTriangle} size={18} color={primary} style={{ marginTop: 2 }} />
                <Text className="flex-1 text-sm leading-5 font-semibold text-foreground">
                  以下 {needs.length} 项未能从原文抽出 —— 已留空待你人工补，系统不预填猜测
                </Text>
              </View>
              {needs.map((key) => {
                const meta = NEED_META[key];
                return <Row key={key} label={meta?.label ?? key} value={meta ? meta.original(payload) : "（见原文对照）"} />;
              })}
            </View>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <View className="flex-row items-center gap-2">
            <Icon as={Lock} size={18} color={primary} />
            <CardTitle className="text-base text-card-foreground">隐私处理</CardTitle>
            <Text className="text-xs text-muted-foreground">
              四步程序 · 拿不准时一律按更安全的一侧处理
            </Text>
          </View>
        </CardHeader>
        <CardContent className="gap-2">
          <AuditLine text="第一步 裁版面 —— 处方前记（患者信息）/ 后记（签名）整块丢弃，只留正文行" />
          <AuditLine text="第二步 只留固定几类 —— 医院 / 处方号 / 日期 / 科室 / 诊断 / 条目，装不下别的身份信息" />
          {auditHits.length > 0 ? (
            <View className="flex-row items-start gap-2">
              <Icon as={AlertTriangle} size={18} color={primary} style={{ marginTop: 2 }} />
              <Text className="flex-1 text-sm leading-5 text-foreground">
                第三步 兜底扫描 —— 命中{" "}
                {auditHits.reduce((sum, [, n]) => sum + n, 0)} 项（
                {auditHits.map(([t, n]) => `${t}×${n}`).join("、")}），已替换为 [已脱敏]
              </Text>
            </View>
          ) : (
            <AuditLine text="第三步 兜底扫描 —— 未命中敏感模式" />
          )}
          <AuditLine text="第四步 出口约束 —— 识别原文用完即弃，只把上面那几类正文发给第三方模型；日志只记类型与次数，不记原文" />
          {(payload.backlinkIntercepted ?? 0) > 0 ? (
            <TintNote icon={AlertTriangle}>
              与原文比对后拦下 {payload.backlinkIntercepted} 项模型补的值（照片里找不到这个串）——
              已丢弃并转人工补，不采用模型编的。
            </TintNote>
          ) : null}
          {payload.fallbackStatus === "unavailable" ? (
            <Text className="text-xs leading-5 text-muted-foreground">
              兜底解析服务本次不可用：缺项保留人工补（不影响已抄录字段）。
            </Text>
          ) : null}
          <Text className="text-xs leading-5 text-muted-foreground">
            原图仅在本次会话的本机内存中显示，不上传保存；服务端只保留上面列出的那几类字段。
          </Text>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="gap-2">
          <SubTitle>照片类型</SubTitle>
          <View className="flex-row flex-wrap gap-2">
            {(payload.layers ?? []).map((layer) => (
              <View key={layer} className="rounded-full bg-secondary px-2.5 py-1">
                <Text className="text-xs font-semibold text-secondary-foreground">{layer}</Text>
              </View>
            ))}
          </View>
          <Text className="text-xs leading-5 text-muted-foreground">
            {payload.type === "prescription"
              ? "处方层：医嘱线只抄录原文，不生成用法用量。"
              : "药盒/标签层：结构上不含医嘱用法用量，本次仅建档。"}
          </Text>
          {payload.labelNotice ? (
            <TintNote icon={AlertTriangle}>
              检测到医院标签层：标签上的用法不会被自动抄录。本次仅建档，请到药箱手动创建计划。
            </TintNote>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={zoom} onOpenChange={(o) => !o && setZoom(false)}>
        <DialogContent className="max-h-[88vh]">
          <DialogHeader>
            <DialogTitle className="text-lg text-card-foreground">原图核对</DialogTitle>
          </DialogHeader>
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              resizeMode="contain"
              style={{ width: "100%", height: 480 }}
              accessibilityLabel="识别原图（放大）"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </View>
  );
}

/** 隐私四步里「已做到」的那一行（勾 + 正文，颜色不单靠图标）。 */
function AuditLine({ text }: { text: string }) {
  const ok = useUnstableNativeVariable("--risk-l1");
  return (
    <View className="flex-row items-start gap-2">
      <Icon as={Check} size={18} color={ok} style={{ marginTop: 2 }} />
      <Text className="flex-1 text-sm leading-5 text-foreground">{text}</Text>
    </View>
  );
}
