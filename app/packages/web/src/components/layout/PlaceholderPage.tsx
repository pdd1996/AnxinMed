import type { ReactNode } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { BackLink } from './BackLink'

/**
 * 骨架占位页统一外壳（M1-T8）。真实页面在 T9/M2/M3 替换各 route 的 children。
 * 用于验证：路由可达、底部导航联动、老年向设计令牌（字号/间距/对比）生效。
 *
 * backTo：二级页（当前只有 /settings）传「我的」路径，页头给出返回入口——
 * 这些页不在底部 tab 的 active 前缀内，没有返回键就只能靠浏览器后退。
 */
export function PlaceholderPage({
  title,
  route,
  milestone,
  backTo,
  children,
}: {
  title: string
  route: string
  milestone: string
  backTo?: string
  children?: ReactNode
}) {
  return (
    <div className="space-y-5">
      {backTo ? <BackLink to={backTo} /> : null}
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
          安心用药 · 骨架占位
        </p>
        <h1 className="text-2xl font-bold">{title}</h1>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription>
            路由{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{route}</code> ·
            真实实现见 {milestone}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-muted-foreground">
          {children ?? (
            <p>本页为 T8 前端骨架占位，用于验证路由可达与老年向设计令牌生效。</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
