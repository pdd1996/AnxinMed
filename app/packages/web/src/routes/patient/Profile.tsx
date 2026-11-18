import { Link } from 'react-router'
import { ChevronRight, ClipboardList, Settings, UserRound, type LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

/**
 * 我的页（任务书 T9）：账号头部 + 列表式入口行。
 * 健康信息自 2026-11-18 起是独立一级页（/health-info，与 /records 同级），不再在本页内嵌表单卡；
 * 两条入口共用 `HealthInfoCard` 组件与同一份 profile 数据。处方抄录·已确认入口在 M2 确认页。
 */
export default function Profile() {
  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
          <UserRound className="size-7" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold">演示用户 · 张某某</h1>
          <p className="text-sm text-muted-foreground">本地演示账号 · 数据仅保存在本机</p>
        </div>
      </header>

      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          <nav aria-label="更多">
            <EntryLink to="/health-info" icon={UserRound} label="健康信息" hint="七项健康档案" />
            <div className="border-t" aria-hidden />
            <EntryLink to="/records" icon={ClipboardList} label="服药记录" hint="查询与导出" />
            <div className="border-t" aria-hidden />
            <EntryLink to="/settings" icon={Settings} label="设置" hint="字号等" />
          </nav>
        </CardContent>
      </Card>
    </div>
  )
}

/** 阿福式列表入口行：图标 tile + 标签/副文案 + 右箭头，整行可点。 */
function EntryLink({ to, icon: Icon, label, hint }: { to: string; icon: LucideIcon; label: string; hint: string }) {
  return (
    <Link to={to} className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/50">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  )
}
