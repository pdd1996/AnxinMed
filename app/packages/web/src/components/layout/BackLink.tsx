import { Link } from 'react-router'
import { ChevronLeft } from 'lucide-react'

/**
 * 二级页返回入口（患者端 web）。
 *
 * 为什么需要：底部 5 个 tab（用药/药箱/录入/AI 咨询/我的）里没有「个人资料 / 健康信息 / 服药记录 / 设置」，
 * 且 `NavLink to="/profile" end={false}` 只匹配 `/profile` 前缀，进这些二级页后底部 tab 一个都不高亮，
 * 页内也没有返回入口——老年用户只能想到浏览器返回键。本组件在页头给出显式「返回」。
 *
 * 为什么不用 navigate(-1)：深链或刷新直接进二级页时没有历史可退，会把人送出应用；
 * 固定回 `/profile` 语义确定（这四页都只从「我的」进入），且与 tab 高亮恢复一致。
 */
export function BackLink({ to = '/profile', label = '返回' }: { to?: string; label?: string }) {
  return (
    <Link
      to={to}
      className="-ml-2 inline-flex min-h-11 items-center gap-0.5 rounded-full px-2 text-base font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      <ChevronLeft className="size-5 shrink-0" aria-hidden />
      {label}
    </Link>
  )
}
