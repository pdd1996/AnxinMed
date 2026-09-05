import { NavLink } from 'react-router'
import { Bot, Box, Camera, CircleUserRound, Home } from 'lucide-react'
import { cn } from '@/lib/utils'

// 5 项，对齐 demo/src/App.tsx 的 navItems（用药/药箱/录入/AI 咨询/我的）。
const navItems = [
  { to: '/', label: '用药', icon: Home, end: true },
  { to: '/box', label: '药箱', icon: Box, end: false },
  { to: '/intake/rx', label: '录入', icon: Camera, end: false },
  { to: '/consult', label: 'AI 咨询', icon: Bot, end: false },
  { to: '/profile', label: '我的', icon: CircleUserRound, end: false },
] as const

/**
 * 患者端底部导航。老年向：每项 ≥44px 触控、图标 + 文字并用、当前项高亮（不单靠颜色）。
 * /doctor/* 独立分支不挂此导航（见 DoctorLayout）。
 */
export function BottomNav() {
  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur"
    >
      <ul className="mx-auto flex w-full max-w-3xl items-stretch">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-semibold transition-colors',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <Icon className="size-6" aria-hidden />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
