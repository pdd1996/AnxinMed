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

/** 药箱汇总卡最多展示的明细条数；更多折叠为「等 N 种」。 */
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

/** 摘要文案：只列非空桶；30 天阈值来自 EXPIRY_WARNING_DAYS，不写死。 */
function summaryText(expiredCount: number, expiringCount: number, separator: string): string {
  const parts: string[] = []
  if (expiredCount > 0) parts.push(`${expiredCount} 种药已过期`)
  if (expiringCount > 0) parts.push(`${expiringCount} 种药 ${EXPIRY_WARNING_DAYS} 天内到期`)
  return parts.join(separator)
}

function detailText(drug: ExpiryDrug, days: number): string {
  return days < 0
    ? `${drug.genericName} · ${drug.expiry} 到期（已过期 ${-days} 天）`
    : `${drug.genericName} · ${drug.expiry} 到期（剩 ${days} 天）`
}

/**
 * 药箱页顶部「效期提醒」汇总卡（30 天临期 / 已过期）。
 * 数据全部来自用户自填的 expiry（见 core 的确认页 / 药箱编辑效期），阈值与咨询 S2、医生端同一份真相。
 * 两桶皆空 → 不渲染（未录入不算正常，但也不制造噪音）。`today` 可注入以便测试确定性，缺省 todayStr()。
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
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={cn('size-5 shrink-0', hasExpired ? 'text-risk-l4' : 'text-risk-l3')}
            aria-hidden
          />
          <h2 className="text-lg font-bold">效期提醒</h2>
        </div>
        <p className="text-sm font-bold">{summaryText(expired.length, expiring.length, '、')}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {shown.map(({ drug, days }) => (
            <li key={drug.id} className={cn('break-words', days < 0 ? 'text-risk-l4' : 'text-risk-l3')}>
              {detailText(drug, days)}
            </li>
          ))}
        </ul>
        {rest > 0 && <p className="text-xs font-semibold text-muted-foreground">等 {rest} 种</p>}
        <p className="rounded-lg border bg-background/60 p-2 text-xs font-semibold">
          过期药请勿继续服用，请按说明书或药师指导处理。
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * 首页「效期提醒」横幅（单行卡片）：有已过期或 30 天内到期的药才出现，给「去药箱查看」入口。
 * 与 ExpiryAlert 共用分桶与文案口径；两桶皆空 → 不渲染。
 */
export function ExpiryBanner({ drugs, today }: { drugs: readonly ExpiryDrug[]; today?: string }) {
  const { expired, expiring } = bucketize(drugs, today ?? todayStr())
  if (expired.length === 0 && expiring.length === 0) return null

  const hasExpired = expired.length > 0
  return (
    <Card className={cn('border', hasExpired ? 'border-risk-l4/40 bg-risk-l4/10' : 'border-risk-l3/40 bg-risk-l3/10')}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
        <p className="flex min-w-0 items-start gap-2 text-sm font-bold">
          <AlertTriangle
            className={cn('mt-0.5 size-5 shrink-0', hasExpired ? 'text-risk-l4' : 'text-risk-l3')}
            aria-hidden
          />
          效期提醒：{summaryText(expired.length, expiring.length, ' / ')}
        </p>
        <Button asChild variant="outline" className="min-h-11 shrink-0">
          <Link to="/box">
            去药箱查看 <ChevronRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
