import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight, ClipboardList, IdCard, Settings, UserRound, type LucideIcon } from 'lucide-react'
import { signOut, useAuthStore } from '@anxin/core'
import { Card, CardContent } from '@/components/ui/card'

/**
 * 我的页（任务书 T9）：账号头部 + 列表式入口行 + 底部账号区（退出登录）。
 * 健康信息自 2026-11-18 起是独立一级页（/health-info，与 /records 同级），不再在本页内嵌表单卡；
 * 两条入口共用 `HealthInfoCard` 组件与同一份 profile 数据。处方抄录·已确认入口在 M2 确认页。
 * 入口行只保留标签 + 箭头；退出登录是账号级动作，按层级归到本页底部（password 模式才显示）。
 *
 * 头部自 G8 增补起读登录态 store（/api/auth/me 的 user.name），不再是写死的「演示用户 · 张某某」：
 * 改完姓名返回本页即可看到新名字。demo 模式保留「演示用户 · 」前缀作为模式标记（本地模拟用户），
 * password 模式只显示姓名——真实账号不该被标成演示用户。
 */
export default function Profile() {
  const authMode = useAuthStore((s) => s.mode)
  const user = useAuthStore((s) => s.user)
  const [signingOut, setSigningOut] = useState(false)

  // name 可空（CLI 开通账号时没给 --name）：给可点的兜底文案，而不是空白头部。
  const displayName = user?.name?.trim() || '未设置姓名'
  const title = authMode === 'demo' ? `演示用户 · ${displayName}` : displayName

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      // 退出后 status=anonymous，RequireAuth 自动跳 /login。
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
          <UserRound className="size-7" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{title}</h1>
        </div>
      </header>

      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          <nav aria-label="更多">
            <EntryLink to="/account" icon={IdCard} label="个人资料" />
            <div className="border-t" aria-hidden />
            <EntryLink to="/health-info" icon={UserRound} label="健康信息" />
            <div className="border-t" aria-hidden />
            <EntryLink to="/records" icon={ClipboardList} label="服药记录" />
            <div className="border-t" aria-hidden />
            <EntryLink to="/settings" icon={Settings} label="设置" />
          </nav>
        </CardContent>
      </Card>

      {authMode !== 'demo' && (
        <Card className="gap-0 py-0">
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="flex min-h-14 items-center justify-center px-4 py-2 text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            <span className="font-medium">{signingOut ? '正在退出…' : '退出登录'}</span>
          </button>
        </Card>
      )}
    </div>
  )
}

/** 阿福式列表入口行：图标 tile + 标签 + 右箭头，整行可点。 */
function EntryLink({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Link to={to} className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/50">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  )
}
