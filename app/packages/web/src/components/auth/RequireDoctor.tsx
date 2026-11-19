import { Navigate, Outlet } from 'react-router'
import { useAuthStore } from '@anxin/core'

/**
 * 医生端路由守卫（specs/25）。
 *
 * 语义：
 * - demo 模式：放行（既有演示 / fixtures E2E 逐字不变）；
 * - password 模式：仅 role='doctor' 放行，其余账号回患者端首页（服务端仍会 403 兜底，前端只是体验层）。
 *
 * 登录态由外层 RequireAuth 负责；本组件只在已认证后判断角色。
 */
export function RequireDoctor() {
  const mode = useAuthStore((s) => s.mode)
  const user = useAuthStore((s) => s.user)

  if (mode === 'demo') return <Outlet />
  if (user?.role !== 'doctor') return <Navigate to="/" replace />
  return <Outlet />
}
