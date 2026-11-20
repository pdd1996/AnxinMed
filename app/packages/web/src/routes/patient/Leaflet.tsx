import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { ChevronDown, ChevronUp, LoaderCircle, ShieldAlert } from 'lucide-react'
import { fetchLeaflet } from '@anxin/core'
import { BackLink } from '@/components/layout/BackLink'
import { cn } from '@/lib/utils'

/**
 * 说明书分段落页（2026-11-20）——咨询卡「查看完整说明书」入口的落地页。
 *
 * - 数据：GET /api/drugs/:id/leaflet（只读，userId 隔离；未收录/越权 404 可见）；
 * - 分段折叠：默认展开「适应症 / 禁忌」，其余按需展开；用法用量段固定为医嘱提示（无剂量数字）；
 * - 未人工核验的说明书顶部固定 banner（与咨询卡同文案），不把未核验原文伪装成已核验结论。
 */
export default function Leaflet() {
  const { drugId = '' } = useParams()
  const { data, isLoading, error } = useQuery({
    queryKey: ['leaflet', drugId],
    queryFn: () => fetchLeaflet(drugId),
    enabled: Boolean(drugId),
  })
  const [openKeys, setOpenKeys] = useState<string[]>(['indication', 'contraindication'])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          正在加载说明书…
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">说明书</p>
        <div className="rounded-2xl border border-risk-l3/40 bg-risk-l3/10 p-4 text-sm">
          <p className="font-semibold">说明书加载失败</p>
          <p className="mt-1 text-muted-foreground">
            {error instanceof Error ? error.message : '本地说明书库未收录该药的说明书'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            可返回药箱查看该药资料，或咨询医生、药师。
          </p>
        </div>
      </div>
    )
  }

  const toggle = (key: string) =>
    setOpenKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))

  return (
    <div className="space-y-4 pb-6">
      <BackLink />
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">说明书</p>
      <div>
        <h1 className="text-2xl font-bold">{data.genericName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {[data.specification, data.form, data.approvalNumbers?.join('、')]
            .filter(Boolean)
            .join(' · ') || '规格/批准文号未标注'}
        </p>
      </div>

      <div className="space-y-1 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p>
          来源：{data.source}
          {data.version ? `（版本 ${data.version}）` : ''}
        </p>
        <p>核验状态：{data.reviewed ? '已人工核验' : '未人工核验'}</p>
      </div>

      {data.notice && (
        <div className="flex items-start gap-2 rounded-xl border border-risk-l2/40 bg-risk-l2/10 p-3 text-sm text-risk-l2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{data.notice}</p>
        </div>
      )}

      <div className="space-y-2">
        {data.sections.map((section) => {
          const open = openKeys.includes(section.key)
          return (
            <div key={section.key} className="overflow-hidden rounded-xl border border-border bg-card">
              <button
                type="button"
                onClick={() => toggle(section.key)}
                aria-expanded={open}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold"
              >
                {section.title}
                {open ? (
                  <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
              </button>
              {open && (
                <p
                  className={cn(
                    'whitespace-pre-line border-t border-border px-3 py-3 text-sm leading-6 text-foreground',
                    section.key === 'dosage' && 'text-muted-foreground',
                  )}
                >
                  {section.body}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        用法用量段为医嘱提示，本页不提供剂量数字；具体用药请咨询医生或药师。说明书内容以药品包装内说明书为准。
      </p>
    </div>
  )
}
