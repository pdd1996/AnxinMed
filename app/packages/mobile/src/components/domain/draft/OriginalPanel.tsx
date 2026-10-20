import { useState, type ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useUnstableNativeVariable } from "nativewind";
import { AlertTriangle, Check, FileText, ImageOff, Lock } from "lucide-react-native";
import type { DraftPayload } from "@anxin/core";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DraftCard, DraftRow, WarnNote } from "@/components/domain/draft/DraftCard";

/**
 * 原文对照面板（M5-T6c，对齐 web `components/domain/draft/OriginalPanel.tsx`，PRD §10.2 第 1 条 / §7.2.5）。
 * 内容是逐块照搬：原图整图展示（RN 加一个全屏 viewer——窄屏没法与结构化字段并排，图会小到看不清）、
 * 本条目原文、处方头部、人工补清单、隐私四步、照片类型。
 *
 * 两处刻意不同（均已可解释，登记在 05e §2-T6-c 交付记录）：
 *  ① 无图降级文案里的「刷新页面」改「关掉应用」——RN 没有刷新这回事，原图在内存会话里（core intakeSession）；
 *  ② 照片类型的贴标告警去掉了 web 侧「（V2.1 已删除该能力）」——那是内部文档版本号，用户读不懂（05d §6-11）。
 */

/** 人工补清单 → 中文标签 + 该行原文（缺失时明确说「原文缺失」，绝不编造）。逐字照搬 web NEED_META。 */
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

export function OriginalPanel({ payload, imageUrl }: { payload: DraftPayload; imageUrl?: string }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const primary = useUnstableNativeVariable("--primary");
  const riskL3 = useUnstableNativeVariable("--risk-l3");

  const w = payload.whitelist ?? null;
  const audit = payload.sanitizeAudit ?? {};
  const auditHits = Object.entries(audit).filter(([, n]) => n > 0);
  const needs = payload.needsManual ?? [];

  return (
    <View className="gap-4">
      <DraftCard
        icon={<FileText size={18} color={primary} importantForAccessibility="no" />}
        title="原文对照"
        subtitle="原文 ↔ 结构化字段，逐项扫读核对"
      >
        {imageUrl ? (
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel="识别原图，点按查看大图"
            onPress={() => setViewerOpen(true)}
            className="active:opacity-90"
          >
            <Image
              source={{ uri: imageUrl }}
              resizeMode="contain"
              style={{ width: "100%", height: 240, borderRadius: 12 }}
            />
            <Text className="mt-1 text-xs text-muted-foreground">
              点图看大图（原图只在本机会话内存里，看完即弃）
            </Text>
          </Pressable>
        ) : (
          <WarnNote
            icon={
              <ImageOff
                size={18}
                color={riskL3}
                importantForAccessibility="no"
                style={{ marginTop: 2 }}
              />
            }
          >
            本次会话已无原图（原图只在内存中即用即弃，关掉应用即丢弃）。请对照下方文字
            <Text className="font-semibold">原文</Text>
            核对；如需看图核对，请返回录入页重新拍摄。
          </WarnNote>
        )}

        {payload.item && (
          <View className="gap-1 rounded-xl border border-border bg-background p-3">
            <Text className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              本条目原文（只留用药相关几类）
            </Text>
            <DraftRow label="药名" value={payload.item.drugName} />
            <DraftRow label="规格" value={payload.item.specification ?? ""} />
            <DraftRow label="数量" value={payload.item.quantity ?? ""} />
            <DraftRow label="用法原文行" value={payload.item.usage ?? ""} mono />
          </View>
        )}

        {w && (
          <View className="gap-1">
            <Text className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              处方头部（只留固定几类）
            </Text>
            <DraftRow label="医院" value={w.hospital ?? ""} />
            <DraftRow label="处方号" value={w.prescriptionNo ?? ""} />
            <DraftRow label="日期" value={w.date ?? ""} />
            <DraftRow label="科室" value={w.department ?? ""} />
            <DraftRow label="诊断" value={w.diagnosis ?? ""} />
          </View>
        )}

        {needs.length > 0 && (
          <View className="gap-2 rounded-xl border border-risk-l3 bg-risk-l3-tint p-3">
            <View className="flex-row items-start gap-2">
              <AlertTriangle size={16} color={riskL3} importantForAccessibility="no" />
              <Text className="flex-1 text-sm font-bold text-foreground">
                以下 {needs.length} 项未能从原文抽出 —— 已留空待你人工补，系统不预填猜测
              </Text>
            </View>
            {needs.map((key) => {
              const meta = NEED_META[key];
              return (
                <View key={key} className="flex-row items-start justify-between gap-3">
                  <Text className="text-sm font-semibold text-foreground">{meta?.label ?? key}</Text>
                  <Text className="max-w-[62%] text-right text-sm text-muted-foreground">
                    {meta ? meta.original(payload) : "（见原文对照）"}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </DraftCard>

      <DraftCard
        icon={<Lock size={16} color={primary} importantForAccessibility="no" />}
        title="隐私处理"
        subtitle="四步程序 · 拿不准时一律按更安全的一侧处理"
      >
        <PrivacyStep ok>第一步 裁版面 —— 处方前记（患者信息）/ 后记（签名）整块丢弃，只留正文行</PrivacyStep>
        <PrivacyStep ok>
          第二步 只留固定几类 —— 医院 / 处方号 / 日期 / 科室 / 诊断 / 条目，装不下别的身份信息
        </PrivacyStep>
        <PrivacyStep ok={auditHits.length === 0}>
          第三步 兜底扫描 ——{" "}
          {auditHits.length > 0
            ? `命中 ${auditHits.reduce((sum, [, n]) => sum + n, 0)} 项（${auditHits
                .map(([t, n]) => `${t}×${n}`)
                .join("、")}），已替换为 [已脱敏]`
            : "未命中敏感模式"}
        </PrivacyStep>
        <PrivacyStep ok>
          第四步 出口约束 —— 识别原文用完即弃，只把上面那几类正文发给第三方模型；日志只记类型与次数，不记原文
        </PrivacyStep>

        {(payload.backlinkIntercepted ?? 0) > 0 && (
          <WarnNote small>
            与原文比对后拦下 {payload.backlinkIntercepted} 项模型补的值（照片里找不到这个串）—— 已丢弃并转人工补，不采用模型编的。
          </WarnNote>
        )}
        {payload.fallbackStatus === "unavailable" && (
          <Text className="text-xs text-muted-foreground">
            兜底解析服务本次不可用：缺项保留人工补（不影响已抄录字段）。
          </Text>
        )}
        <Text className="text-xs text-muted-foreground">
          原图仅在本机会话内存中显示，不上传保存；服务端只保留上面列出的那几类字段。
        </Text>
      </DraftCard>

      <DraftCard title="照片类型">
        <View className="flex-row flex-wrap gap-2">
          {(payload.layers ?? []).map((layer) => (
            <View key={layer} className="rounded-full bg-secondary px-3 py-1">
              <Text className="text-xs font-semibold text-secondary-foreground">{layer}</Text>
            </View>
          ))}
        </View>
        <Text className="text-xs text-muted-foreground">
          {payload.type === "prescription"
            ? "处方层：医嘱线只抄录原文，不生成用法用量。"
            : "药盒/标签层：结构上不含医嘱用法用量，本次仅建档。"}
        </Text>
        {payload.labelNotice && (
          <WarnNote small>
            检测到医院标签层：标签上的用法<Text className="font-semibold">不会</Text>
            被自动抄录。本次仅建档，请到药箱手动创建计划。
          </WarnNote>
        )}
      </DraftCard>

      {/* 全屏 viewer：窄屏的补偿手段（web 是并排大图，RN 一张 240 高的缩略图看不清小字） */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-[calc(100%-1rem)] border-0 bg-black p-2">
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              resizeMode="contain"
              style={{ width: "100%", height: 520 }}
              accessibilityLabel="识别原图大图"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </View>
  );
}

function PrivacyStep({ ok, children }: { ok: boolean; children: ReactNode }) {
  const riskL1 = useUnstableNativeVariable("--risk-l1");
  const riskL3 = useUnstableNativeVariable("--risk-l3");
  return (
    <View className="flex-row items-start gap-2">
      {ok ? (
        <Check size={16} color={riskL1} importantForAccessibility="no" style={{ marginTop: 2 }} />
      ) : (
        <AlertTriangle size={16} color={riskL3} importantForAccessibility="no" style={{ marginTop: 2 }} />
      )}
      <Text className="flex-1 text-sm leading-5 text-foreground">{children}</Text>
    </View>
  );
}