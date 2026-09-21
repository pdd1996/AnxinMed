import { Link } from 'react-router'
import { AlertTriangle, ChevronRight, ClipboardList, Settings, UserRound, type LucideIcon } from 'lucide-react'
import { HealthInfoCard } from '@/components/domain/profile/HealthInfoCard'
import { Card, CardContent } from '@/components/ui/card'

/**
 * 我的页（任务书 T9）：健康信息两入口之一（手动填写）。视觉参照蚂蚁阿福「编辑家庭成员」：
 * 头像+账号头部、分组表单卡（HealthInfoCard 常驻字段+待补充+弹窗编辑）、列表式入口行。
 * 处方抄录·已确认入口在 M2 确认页（HealthCard 建议填入勾选区）。
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

      <HealthInfoCard />

      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          <nav aria-label="更多">
            <EntryLink to="/records" icon={ClipboardList} label="服药记录" hint="查询与导出" />
            <div className="border-t" aria-hidden />
            <EntryLink to="/settings" icon={Settings} label="设置" hint="字号等" />
          </nav>
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 rounded-xl border border-risk-l3/40 bg-risk-l3/10 p-3 text-xs text-risk-l3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        仅供产品测试：使用 Mock 药品与说明书数据（演示抄录，未经医学审核），不用于真实诊疗、处方或用药决策。
      </p>
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
