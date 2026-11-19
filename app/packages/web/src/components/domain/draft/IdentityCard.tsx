import { Hand, Pill, ShieldCheck, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { DOSE_UNITS } from '@anxin/shared'
import {
  approvalMatchesCandidate,
  identityNeedsManual,
  infoConflicts,
  isManualMode,
  selectableCandidates,
  type ConfirmFormState,
  type DraftPayload,
} from '@anxin/core'

/** 库条目 / 识别抄录字段的对照行。 */
function FieldRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-semibold">{value || '—'}</dd>
    </div>
  )
}

/**
 * 药品身份卡（PRD §7.2.5 / §8.2）：药名 + 规格 + 剂型三项严格核对。
 * 唯一匹配 → 展示库条目；多候选/冲突 → 冲突清单**系统不选边**，由用户选定或改手动建档；
 * 无匹配 → 手动建档（标注「未经 OCR 确认」，AI 个性化咨询不可用）。needsManual 覆盖的身份字段一律留空。
 */
export function IdentityCard({
  payload,
  state,
  patch,
}: {
  payload: DraftPayload
  state: ConfirmFormState
  patch: (partial: Partial<ConfirmFormState>) => void
}) {
  const candidates = selectableCandidates(payload)
  const manualMode = isManualMode(payload, state)
  const unique = payload.match?.status === 'unique' ? payload.match.match : null
  const infos = infoConflicts(payload)
  const identity = payload.identity ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Pill className="size-5 text-primary" aria-hidden />
          药品身份
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {manualMode ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-3 text-sm text-risk-l3">
              <Hand className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                身份线无唯一匹配 —— 请对照药品实物手动建档。该药将标注「未经 OCR 确认」，AI 个性化咨询不可用，仅可做 L0
                资料查询。
              </span>
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="id-name">药名</Label>
                <Input
                  id="id-name"
                  value={state.manual.genericName}
                  onChange={(e) => patch({ manual: { ...state.manual, genericName: e.target.value } })}
                  placeholder={identityNeedsManual(payload, 'genericName') ? '原文未识别到，请照着药盒填写' : '请核对识别值'}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="id-spec">规格</Label>
                <Input
                  id="id-spec"
                  value={state.manual.specification}
                  onChange={(e) => patch({ manual: { ...state.manual, specification: e.target.value } })}
                  placeholder="如：0.1%（10mL：10mg）"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="id-form">剂型</Label>
                <Input
                  id="id-form"
                  value={state.manual.form}
                  onChange={(e) => patch({ manual: { ...state.manual, form: e.target.value } })}
                  placeholder="如：滴眼液"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="id-stock">库存（可选，用于「用完为止」推算）</Label>
                <div className="flex gap-2">
                  <Input
                    id="id-stock"
                    type="number"
                    min={0}
                    className="flex-1"
                    value={state.manual.stockValue}
                    onChange={(e) => patch({ manual: { ...state.manual, stockValue: e.target.value } })}
                  />
                  <select
                    aria-label="库存单位"
                    value={state.manual.stockUnit}
                    onChange={(e) => patch({ manual: { ...state.manual, stockUnit: e.target.value } })}
                    className="min-h-11 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {DOSE_UNITS.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            {candidates.length > 0 && (
              <Button variant="ghost" className="min-h-10" onClick={() => patch({ useManual: false })}>
                <Undo2 className="size-4" aria-hidden /> 返回冲突清单选择候选
              </Button>
            )}
          </div>
        ) : candidates.length > 0 ? (
          <div className="space-y-3">
            {/* 2026-11-20：冲突清单的两段提示文案（「系统不选边」横幅 + 每条冲突说明）按用户要求删除，
                只保留候选单选列表；「不选边」由 core 初值保证（selectedCandidateId 恒为 ''），不依赖文案。 */}
            {/* 批准文号选填（2026-11-19）：只作「候选定位」辅助——不校验、不落库、不阻塞确认。
                口径（2026-11-20 用户现场提问）：批准文号 =「国药准字 + 类别字母 + 8 位数字」，
                字母随药类变（H 化学药 / Z 中药 / S 生物制品 / B 保健药 / T 体外诊断试剂 / F 辅料），
                **不能按 H 写死**；生产批号（如 20250812）一批一变，不是身份字段，别和批准文号混称。 */}
            <div className="space-y-1 rounded-lg border border-dashed border-input bg-muted/40 p-3">
              <Label htmlFor="id-approval">批准文号（选填）</Label>
              <Input
                id="id-approval"
                value={state.approvalInput}
                onChange={(e) => patch({ approvalInput: e.target.value })}
                placeholder="如 20138002"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                盒子上的批准文号长这样：<span className="whitespace-nowrap">国药准字H20138002</span>。字母（H / Z / S…）不用填，只填后面那串数字；它不是生产批号。
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                填了只帮你在候选里定位记录，<strong>不做官方校验</strong>；以包装/说明书为准。
              </p>
              {state.approvalInput.trim() &&
                (candidates.some((c) => approvalMatchesCandidate(c, state.approvalInput)) ? (
                  <p className="text-xs leading-5 text-risk-l2">
                    已命中下方带「批准文号命中」的候选（用户填写·未校验），请核对实物规格后点选。
                  </p>
                ) : (
                  <p className="text-xs leading-5 text-risk-l3">
                    填写的批准文号在候选中没有命中，请核对后重填；也可以直接按实物规格选择，或改用手动建档。
                  </p>
                ))}
            </div>
            <div className="space-y-2">
              {candidates.map((c) => (
                <label
                  key={c.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
                    state.selectedCandidateId === c.id ? 'border-primary bg-primary/10' : 'border-input bg-background',
                  )}
                >
                  <input
                    type="radio"
                    name="draft-candidate"
                    className="mt-1 size-5"
                    checked={state.selectedCandidateId === c.id}
                    onChange={() => patch({ selectedCandidateId: c.id })}
                  />
                  <span className="min-w-0">
                    <strong className="block text-base">{c.genericName}</strong>
                    <span className="block text-sm text-muted-foreground">
                      {c.brandName ? `${c.brandName} · ` : ''}
                      {c.specification} · {c.form}
                    </span>
                    <span className="block text-xs text-muted-foreground">厂家：{c.manufacturer || '—'}</span>
                    {c.multiSpec && (
                      <span className="mt-1 inline-block rounded-full bg-risk-l3/15 px-2 py-0.5 text-xs font-semibold text-risk-l3">
                        多规格库条目 · 规格以实物为准
                      </span>
                    )}
                    {state.approvalInput.trim() && approvalMatchesCandidate(c, state.approvalInput) && (
                      <span className="mt-1 ml-1 inline-block rounded-full bg-risk-l2/15 px-2 py-0.5 text-xs font-semibold text-risk-l2">
                        批准文号命中（用户填写·未校验）
                      </span>
                    )}
                  </span>
                </label>
              ))}
              <Button variant="outline" className="min-h-10 w-full" onClick={() => patch({ useManual: true })}>
                <Hand className="size-4" aria-hidden /> 都不符 · 改用手动建档
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-risk-l2">
              <ShieldCheck className="size-4 shrink-0" aria-hidden />
              药品库唯一匹配 · 仍需你核对实物后确认
            </p>
            {unique && (
              <dl className="space-y-1 rounded-lg border bg-background p-3 text-sm">
                <p className="mb-1 text-base font-bold">{unique.genericName}</p>
                <FieldRow label="商品名" value={unique.brandName} />
                <FieldRow label="规格" value={unique.specification} />
                <FieldRow label="剂型" value={unique.form} />
                <FieldRow label="厂家" value={unique.manufacturer} />
                {/* 批准文号不再作为身份核对字段：批号随规格/注册变更不同，且多印在包装侧面，
                    展示库里的"主批号"会让人误以为是识别出来的、甚至张冠李戴（2026-11-19 现场反馈）。 */}
              </dl>
            )}
            {payload.match?.resolutionNote && (
              <p className="rounded-lg border border-risk-l2/35 bg-risk-l2/10 p-2 text-xs text-risk-l2">
                {payload.match.resolutionNote}
              </p>
            )}
            <Button variant="outline" className="min-h-10 w-full" onClick={() => patch({ useManual: true })}>
              <Hand className="size-4" aria-hidden /> 不是这个药 · 改用手动建档
            </Button>
          </div>
        )}

        {/* 识别抄录值（VLM/OCR 提取，非库条目）：供与实物对照；needsManual 覆盖项不显示值（留空待补） */}
        {identity && (
          <dl className="space-y-1 rounded-lg border border-dashed bg-muted/40 p-3 text-sm">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">识别抄录值（供对照）</p>
            <FieldRow label="药名" value={identity.genericName} />
            <FieldRow label="商品名" value={identity.brandName} />
            <FieldRow label="规格" value={identityNeedsManual(payload, 'specification') ? '' : identity.specification} />
            <FieldRow label="剂型" value={identityNeedsManual(payload, 'form') ? '' : identity.form} />
            <FieldRow label="厂家" value={identity.manufacturer} />
            {/* 批号只在照片里真的读到才显示（识别值可核对；默认不显示「—」占位，避免误以为是身份字段） */}
            {identity.approvalNumber && <FieldRow label="批准文号（照片抄录）" value={identity.approvalNumber} />}
            {identity.otcFlag && <FieldRow label="类别" value="非处方药（OTC）" />}
          </dl>
        )}

        {infos.map((conflict, idx) => (
          <p key={`info-${idx}`} className="rounded-lg border border-risk-l2/35 bg-risk-l2/10 p-2 text-sm text-risk-l2">
            {conflict.note}
          </p>
        ))}
      </CardContent>
    </Card>
  )
}
