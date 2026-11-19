import { CalendarDays, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ConfirmFormState } from '@anxin/core'

/**
 * 有效期与开封日期卡（确认页第二列，身份卡之后）。
 *
 * 效期线是**用户对照药盒自填**的数据：管线不识别、不推算
 * （说明书只有通用保质期，如「24 个月」，推不出这一盒的具体到期日），初始恒空（红线①不预填）。
 * 两个日期都可留空 = 未录入，确认后可到药箱「编辑效期」补录；允许已过期日期（如实记录后触发过期提示）。
 */
export function ExpiryCard({
  state,
  patch,
}: {
  state: ConfirmFormState
  patch: (partial: Partial<ConfirmFormState>) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarDays className="size-5 text-primary" aria-hidden />
          有效期与开封（可选）
          <span className="text-xs font-normal text-muted-foreground">照药盒自填 · 系统不识别</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            这两个日期请<strong>你自己对照药盒包装</strong>填写 —— 系统不会从照片里识别，也不会替你推算
            （说明书只有通用保质期，如「24 个月」，推不出这一盒的具体到期日）。可留空，确认后可到药箱「编辑效期」补录。
          </span>
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ec-expiry">有效期至</Label>
            <Input
              id="ec-expiry"
              type="date"
              className="min-h-11"
              value={state.expiry}
              onChange={(e) => patch({ expiry: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">药盒上「有效期至 / 失效日期」；已过期也请如实填。</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ec-opened">开封日期（可选）</Label>
            <Input
              id="ec-opened"
              type="date"
              className="min-h-11"
              value={state.openedAt}
              onChange={(e) => patch({ openedAt: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">第一次打开包装的日期；不记得可留空。</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
