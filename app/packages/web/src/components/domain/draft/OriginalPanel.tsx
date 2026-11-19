import { AlertTriangle, FileText, ImageOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DraftPayload } from '@anxin/core'

/** 人工补清单 → 中文标签 + 该行原文（缺失时明确说「原文缺失」，绝不编造）。 */
const NEED_META: Record<string, { label: string; original: (p: DraftPayload) => string }> = {
  drugName: { label: '药名', original: (p) => p.item?.drugName || '（原文未识别到该行）' },
  genericName: { label: '药名', original: (p) => p.identity?.genericName || '（原文未识别到该行）' },
  specification: { label: '规格', original: (p) => p.item?.specification || p.identity?.specification || '（原文缺失或被涂黑）' },
  form: { label: '剂型', original: (p) => p.identity?.form || '（原文缺失或被涂黑）' },
  quantity: { label: '数量', original: (p) => p.item?.quantity || '（原文缺失或被涂黑）' },
  usage: { label: '用法用量', original: (p) => p.item?.usage || '（原文该行缺失或被涂黑）' },
  date: { label: '处方日期', original: (p) => p.whitelist?.date || '（原文缺失或被涂黑）' },
  hospital: { label: '医院', original: (p) => p.whitelist?.hospital || '（原文缺失或被涂黑）' },
  items: { label: '处方条目', original: () => '（未定位到处方正文条目）' },
}

/**
 * 原文对照面板（PRD §10.2 第 1 条 / §7.2.5）：原文整图 ↔ 结构化字段并排（qwen3.5-ocr 行级契约，
 * 无字符级置信度与裁剪几何，不再做 CSS 裁剪/红框叠加）。取不到会话内原图（刷新/直接打开链接）→
 * 降级为文字原文对照，明确告知。隐私四步说明卡与照片类型卡已按 2026-11-19 用户要求从本页移除；
 * 「与原文比对拦下模型补值」「兜底解析不可用」「检测到医院标签层」三类告警仍按条件显示，不静默。
 */
export function OriginalPanel({ payload, imageUrl }: { payload: DraftPayload; imageUrl?: string }) {
  const w = payload.whitelist ?? null
  const needs = payload.needsManual ?? []

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="size-5 text-primary" aria-hidden />
            原文对照
            <span className="text-xs font-normal text-muted-foreground">原文 ↔ 结构化字段，逐项扫读核对</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {imageUrl ? (
            <img src={imageUrl} alt="识别原图" className="max-h-[26rem] w-full rounded-lg border object-contain" />
          ) : (
            <p className="flex items-start gap-2 rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-3 text-sm text-risk-l3">
              <ImageOff className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>
                本次会话已无原图（原图只在内存中即用即弃，刷新页面即丢弃）。请对照下方<strong>文字原文</strong>核对；
                如需看图核对，请返回录入页重新拍摄。
              </span>
            </p>
          )}

          {payload.item && (
            <dl className="space-y-1 rounded-lg border bg-background p-3 text-sm">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">本条目原文（只留用药相关几类）</p>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">药名</dt>
                <dd className="text-right font-semibold">{payload.item.drugName || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">规格</dt>
                <dd className="text-right font-semibold">{payload.item.specification || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">数量</dt>
                <dd className="text-right font-semibold">{payload.item.quantity || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">用法原文行</dt>
                <dd className="max-w-[60%] text-right font-semibold">
                  {payload.item.usage ? <code className="break-all">{payload.item.usage}</code> : '—'}
                </dd>
              </div>
            </dl>
          )}

          {w && (
            <dl className="space-y-1 text-sm">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">处方头部（只留固定几类）</p>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">医院</dt>
                <dd className="text-right font-semibold">{w.hospital || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">处方号</dt>
                <dd className="text-right font-semibold">{w.prescriptionNo || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">日期</dt>
                <dd className="text-right font-semibold">{w.date || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">科室</dt>
                <dd className="text-right font-semibold">{w.department || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">诊断</dt>
                <dd className="text-right font-semibold">{w.diagnosis || '—'}</dd>
              </div>
            </dl>
          )}

          {needs.length > 0 && (
            <div className="space-y-2 rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-3">
              <p className="flex items-center gap-2 text-sm font-bold text-risk-l3">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                以下 {needs.length} 项未能从原文抽出 —— 已留空待你人工补，系统不预填猜测
              </p>
              <ul className="space-y-1 text-sm">
                {needs.map((key) => {
                  const meta = NEED_META[key]
                  return (
                    <li key={key} className="flex justify-between gap-3">
                      <span className="font-semibold text-risk-l3">{meta?.label ?? key}</span>
                      <span className="max-w-[62%] text-right text-muted-foreground">
                        {meta ? meta.original(payload) : '（见原文对照）'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {(payload.backlinkIntercepted ?? 0) > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-2 text-xs text-risk-l3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              与原文比对后拦下 {payload.backlinkIntercepted} 项模型补的值（照片里找不到这个串）—— 已丢弃并转人工补，不采用模型编的。
            </p>
          )}
          {payload.fallbackStatus === 'unavailable' && (
            <p className="text-xs text-muted-foreground">兜底解析服务本次不可用：缺项保留人工补（不影响已抄录字段）。</p>
          )}
        </CardContent>
      </Card>

      {payload.labelNotice && (
        <p className="flex items-start gap-2 rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-2 text-sm text-risk-l3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          检测到医院标签层：标签上的用法<strong>不会</strong>被自动抄录（V2.1 已删除该能力）。本次仅建档，请到药箱手动创建计划。
        </p>
      )}
    </div>
  )
}
