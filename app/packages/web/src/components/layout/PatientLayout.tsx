import { Link, Outlet, useLocation } from 'react-router'
import { Settings as SettingsIcon } from 'lucide-react'
import { APP_NAME } from '@anxin/shared'
import { cn } from '@/lib/utils'
import { BottomNav } from './BottomNav'

/**
 * 宽版页面（PRD §10.2：确认页需「原文截图 ↔ 结构化字段并排」）：这些路由前缀用 max-w-6xl，
 * 其余沿用 max-w-3xl 的单列阅读宽度（老年向）。窄屏下确认页自动堆叠为单列，不受影响。
 */
const WIDE_PREFIXES = ['/drafts/', '/intake/']

/**
 * 患者端外壳：顶栏（品牌 + 设置入口）+ 内容 Outlet + 底部导航。
 * 设置入口在顶栏，因底部导航只放 5 个主 Tab（不含 /settings）。
 */
export function PatientLayout() {
  const { pathname } = useLocation()
  const wide = WIDE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-14 w-full max-w-3xl items-center justify-between px-4">
          <Link to="/" className="text-base font-bold tracking-wide text-primary">
            {APP_NAME}
          </Link>
          <Link
            to="/settings"
            aria-label="设置（字号等）"
            className="touch-target flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <SettingsIcon className="size-6" aria-hidden />
          </Link>
        </div>
      </header>

      <main className={cn('mx-auto w-full flex-1 px-4 pt-6 pb-28', wide ? 'max-w-6xl' : 'max-w-3xl')}>
        <Outlet />
      </main>

      <BottomNav />
    </div>
  )
}
