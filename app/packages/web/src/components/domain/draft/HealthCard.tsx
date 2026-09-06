import { Info, ShieldQuestion, UserRound } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ConfirmFormState, DraftPayload } from '@/lib/draft'

/**
 * 健康信息「建议填入」勾选区（PRD §7.1.2 入口二 / §10.2）：勾选才写入 health_profiles。
 * 契约：提交的 fieldKey 一律取自 payload.healthSuggestions —— 清单外字段服务端 400 拒绝
 * （防伪造 prescription_confirmed 溯源），需手动填写请走「我的 · 健康信息」。
 * 值与建议一致 → 落「处方笺抄录 · 已确认」；用户改过值 → 落「用户自述」（溯源诚实，由服务端判定）。
 */
export function HealthCard({
  payload,
  state,
  patch,
}: {
  payload: DraftPayload
  state: ConfirmFormState
  patch: (partial: Partial<ConfirmFormState>) => void
}) {
  const suggestions = payload.healthSuggestions ?? []
  if (suggestions.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserRound className="size-5 text-primary" aria-hidden />
          健康信息 · 建议填入
          <span className="text-xs font-normal text-muted-foreground">勾选才写入，字段级来源标注</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((s) => {
          const checked = Boolean(state.healthChecked[s.field])
          const value = state.healthValue[s.field] ?? s.value
          const edited = value.trim() !== s.value.trim()
          return (
            <div key={s.field} className="space-y-2 rounded-lg border bg-background p-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-5"
                  aria-label={`勾选写入${s.field}`}
                  checked={checked}
                  onChange={() => patch({ healthChecked: { ...state.healthChecked, [s.field]: !checked } })}
                />
                <span className="min-w-0 flex-1">
                  <strong className="block text-base">{s.field}</strong>
                  <span className="block text-xs text-muted-foreground">
                    来源：{s.source} · {edited ? '你已修改，将标注为「用户自述」' : '与建议一致，将标注为「处方笺抄录 · 已确认」'}
                  </span>
                </span>
              </label>
              {checked && (
                <Input
                  aria-label={`${s.field}（写入值）`}
                  value={value}
                  onChange={(e) => patch({ healthValue: { ...state.healthValue, [s.field]: e.target.value } })}
                />
              )}
            </div>
          )
        })}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          产品不做诊断：「诊断」字段语义永远为「用户报告的诊断」，AI 将其视为用户提供的、未经医学验证的信息。
          不勾选即不写入，随时可在「我的 · 健康信息」手动补。
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * 「这是给谁用的药」（PRD §7.2.5 / §10.2）。
 * 与 demo 的差异（口径已定）：新管线 L0 裁剪 + L1 闭合白名单**结构性丢弃**处方前记（姓名/性别/年龄/门诊号），
 * 前端拿不到患者信息、无法做不一致比对 —— 隐私红线优先。故对处方草稿恒定提示并作为确认闸门之一（勾选后放行），
 * 由用户自己核对使用人，而不是让系统去猜或去存身份字段。
 */
export function WhoCard({ state, patch }: { state: ConfirmFormState; patch: (partial: Partial<ConfirmFormState>) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldQuestion className="size-5 text-risk-l3" aria-hidden />
          这是给谁用的药？
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex items-start gap-2 rounded-lg border border-risk-l3/40 bg-risk-l3/10 p-3 text-sm text-risk-l3">
          <UserRound className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            处方笺上的患者信息（姓名 / 性别 / 年龄 / 门诊号）已按隐私红线<strong>整块丢弃</strong>，系统无法替你核对使用人。
            家里多人用药时，请自己确认这盒药是给谁用的 —— 药箱与提醒都记在当前账号下。
          </span>
        </p>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="size-5"
            checked={state.whoConfirmed}
            onChange={() => patch({ whoConfirmed: !state.whoConfirmed })}
          />
          我已确认本药的使用人
        </label>
      </CardContent>
    </Card>
  )
}
