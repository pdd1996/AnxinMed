import { useQuery } from '@tanstack/react-query'
import { fetchProfile } from '@anxin/core'
import { HEALTH_FIELDS, ageFromBirthMonth } from '@anxin/shared'
import { HealthInfoCard } from '@/components/domain/profile/HealthInfoCard'
import { BackLink } from '@/components/layout/BackLink'

/**
 * 健康信息一级页（2026-11-18 UI 调整）：从「我的」页内嵌卡升级为与「服药记录」同级的独立页。
 * 页面负责标题/说明/补充进度；字段行与编辑弹窗仍全部复用 `HealthInfoCard`（showHeader=false），
 * 两条入口走同一份数据与同一套 PATCH 逻辑，不存在第二套真相。
 */
export default function HealthInfo() {
  const { data } = useQuery({ queryKey: ['profile'], queryFn: fetchProfile })
  const entries = data?.items ?? []
  // 「年龄」与出生年月联动：有出生年月时年龄自动派生，也算已补充（老数据可能只存了出生年月）。
  const derivedAge = ageFromBirthMonth(entries.find((entry) => entry.fieldKey === '出生年月')?.value ?? '')
  const filled = HEALTH_FIELDS.filter(
    (field) =>
      entries.some((entry) => entry.fieldKey === field && entry.value?.trim()) ||
      (field === '年龄' && derivedAge !== null),
  ).length
  const total = HEALTH_FIELDS.length
  const pct = Math.round((filled / total) * 100)

  return (
    <div className="space-y-4">
      <BackLink />
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">健康信息</p>
      <div>
        <h1 className="text-2xl font-bold">七项健康档案</h1>
      </div>

      {data && (
        <div className="rounded-2xl border border-border bg-card p-4" aria-label={`已补充 ${filled} / ${total} 项`}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">已补充</span>
            <span className="font-semibold">
              {filled} / {total} 项
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <HealthInfoCard showHeader={false} />
    </div>
  )
}
