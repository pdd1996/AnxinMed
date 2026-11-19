import { Link } from 'react-router'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { daysUntilExpiry, EXPIRY_WARNING_DAYS, expiryState, todayStr } from '@anxin/shared'

/** 提醒所需的最小药品字段（药箱 DrugItem / 首页 fetchDrugs 条目结构上均满足）。 */
export interface ExpiryDrug {
  id: string
  genericName: string
  /** 有效期（YYYY-MM-DD）；null/undefined/非法日期 = 未录入（≠ 正常）。 */
  expiry?: string | null
}

interface ExpiryBucket {
  drug: ExpiryDrug
  /** 距到期天数（负 = 已过期天数）。 */
  days: number
}

/** 汇总卡最多展示的明细条数；更多折叠为「等 N 种」。 */
const MAX_DETAIL_ROWS = 6

/**
 * 按 shared 的 expiryState 分桶（已过期 / 临期）。
 * 未录入或非法日期 → expiryState 返回 null，**不进入任一桶**（绝不把未录入当成「正常」）。
 * 桶内按剩余天数升序：最先到期 / 过期最久的排最前，提醒顺序稳定可测。
 */
function bucketize(drugs: readonly ExpiryDrug[], today: string): { expired: ExpiryBucket[]; expiring: ExpiryBucket[] } {
  const expired: ExpiryBucket[] = []
  const expiring: ExpiryBucket[] = []
  for (const drug of drugs) {
    const state = expiryState(drug.expiry, today)
    if (state !== 'expired' && state !== 'expiring') continue
    const days = daysUntilExpiry(drug.expiry, today)
    if (days === null) continue // 防御：state 非 null 时 days 必非 null
    const bucket = state === 'expired' ? expired : expiring
    bucket.push({ drug, days })
  }
  expired.sort((a, b) => a.days - b.days)
  expiring.sort((a, b) => a.days - b.days)
  return { expired, expiring }
}

/** 明细第二行：到期日 + 状态（「已过期 5 天」不拆行由调用方 nowrap 保证）。 */
function metaText(expiry: string | null | undefined, days: number): string {
  if (days < 0) return `${expiry} 到期 · 已过期 ${-days} 天`
  if (days === 0) return `${expiry} 到期 · 今天到期`
  return `${expiry} 到期 · 剩 ${days} 天`
}

/**
 * 计数摘要（标题下第二行）：已过期 / 临期各一段，**段内 nowrap**——
 * 窄屏只会在两段之间换行，不会出现「30 天 / 内到期」被拆开。30 天阈值来自 EXPIRY_WARNING_DAYS。
 */
function ExpirySummary({
  expiredCount,
  expiringCount,
  className,
}: {
  expiredCount: number
  expiringCount: number
  className?: string
}) {
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold', className)}>
      {expiredCount > 0 && <span className="whitespace-nowrap text-risk-l4">已过期 {expiredCount} 种</span>}
      {expiredCount > 0 && expiringCount > 0 && (
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
      )}
      {expiringCount > 0 && (
        <span className="whitespace-nowrap text-risk-l3">
          {EXPIRY_WARNING_DAYS} 天内到期 {expiringCount} 种
        </span>
      )}
    </p>
  )
}

/**
 * 药箱页顶部「效期提醒」汇总卡（30 天临期 / 已过期）。
 * 数据全部来自用户自填的 expiry（见 core 的确认页 / 药箱编辑效期），阈值与咨询 S2、医生端同一份真相。
 * 两桶皆空 → 不渲染（未录入不算正常，但也不制造噪音）。`today` 可注入以便测试确定性，缺省 todayStr()。
 *
 * 排版：图标 + 标题/计数两行；明细每条「药名（粗体）+ 到期日/状态（小字）」，长药名截断、
 * 状态行 nowrap —— 窄屏不再出现「到期（已过期 5 / 天）」这类半个词换行。
 */
export function ExpiryAlert({ drugs, today }: { drugs: readonly ExpiryDrug[]; today?: string }) {
  const { expired, expiring } = bucketize(drugs, today ?? todayStr())
  if (expired.length === 0 && expiring.length === 0) return null

  const hasExpired = expired.length > 0
  const all = [...expired, ...expiring]
  const shown = all.slice(0, MAX_DETAIL_ROWS)
  const rest = all.length - shown.length

  return (
    <Card className={cn('border', hasExpired ? 'border-risk-l4/40 bg-risk-l4/10' : 'border-risk-l3/40 bg-risk-l3/10')}>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-xl',
              hasExpired ? 'bg-risk-l4/15 text-risk-l4' : 'bg-risk-l3/15 text-risk-l3',
            )}
          >
            <AlertTriangle className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold">效期提醒</h2>
            <ExpirySummary expiredCount={expired.length} expiringCount={expiring.length} />
          </div>
        </div>

        <ul className="space-y-2">
          {shown.map(({ drug, days }) => {
            const isExpired = days < 0
            return (
              <li key={drug.id} className="flex min-w-0 items-start gap-2">
                <span
                  className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', isExpired ? 'bg-risk-l4' : 'bg-risk-l3')}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{drug.genericName}</p>
                  <p
                    className={cn(
                      'whitespace-nowrap text-xs font-semibold',
                      isExpired ? 'text-risk-l4' : 'text-risk-l3',
                    )}
                  >
                    {metaText(drug.expiry, days)}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
        {rest > 0 && <p className="text-xs font-semibold text-muted-foreground">等 {rest} 种</p>}
      </CardContent>
    </Card>
  )
}

/**
 * 首页「效期提醒」横幅（单行卡片）：有已过期或 30 天内到期的药才出现，给「去药箱」入口。
 * 排版：图标 + 两行文案（标题 / 分段计数）+ 右侧紧凑链接；与 ExpiryAlert 共用分桶与阈值口径。
 */
export function ExpiryBanner({ drugs, today }: { drugs: readonly ExpiryDrug[]; today?: string }) {
  const { expired, expiring } = bucketize(drugs, today ?? todayStr())
  if (expired.length === 0 && expiring.length === 0) return null

  const hasExpired = expired.length > 0
  return (
    <Card className={cn('border', hasExpired ? 'border-risk-l4/40 bg-risk-l4/10' : 'border-risk-l3/40 bg-risk-l3/10')}>
      <CardContent className="flex items-center gap-3 py-3">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl',
            hasExpired ? 'bg-risk-l4/15 text-risk-l4' : 'bg-risk-l3/15 text-risk-l3',
          )}
        >
          <AlertTriangle className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">效期提醒</p>
          <ExpirySummary expiredCount={expired.length} expiringCount={expiring.length} className="mt-0.5" />
        </div>
        <Button asChild variant="ghost" size="sm" className="min-h-11 shrink-0 px-2">
          <Link to="/box" className="flex items-center gap-0.5 whitespace-nowrap">
            去药箱 <ChevronRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
