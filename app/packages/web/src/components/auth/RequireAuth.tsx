import { Navigate, Outlet, useLocation } from 'react-router'
import { bootstrapAuth, useAuthStore } from '@anxin/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * 登录守卫（G7）：包裹患者端与医生端路由。
 *
 * - idle/loading：启动恢复中 → 全屏「正在检查登录状态」，避免先闪一下业务页再跳登录；
 * - anonymous：跳 /login，并把当前路径放进 state.from（登录成功后回原页）；
 * - error：登录态检查本身失败（网络/服务异常）→ 明确展示 + 重试，不静默当作未登录；
 * - authenticated：渲染子路由。
 *
 * demo 模式（AUTH_MODE=demo）下 /api/auth/me 返回 p-001 → 直接 authenticated，不出现登录页，
 * 既有 fixtures E2E 与本地开发行为不变。
 */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status)
  const error = useAuthStore((s) => s.error)
  const location = useLocation()
  const from = `${location.pathname}${location.search}`

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-base text-muted-foreground">正在检查登录状态…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">暂时无法确认登录状态</CardTitle>
            <CardDescription className="text-base leading-7">
              {error ?? '请检查网络或服务器连接后重试。'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="min-h-11 w-full" onClick={() => void bootstrapAuth()}>
              重试
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from }} />
  }

  return <Outlet />
}
