import { Link, Outlet } from 'react-router'
import { Settings as SettingsIcon } from 'lucide-react'
import { APP_NAME } from '@anxin/shared'
import { BottomNav } from './BottomNav'

/**
 * 患者端外壳：顶栏（品牌 + 设置入口）+ 内容 Outlet + 底部导航。
 * 设置入口在顶栏，因底部导航只放 5 个主 Tab（不含 /settings）。
 */
export function PatientLayout() {
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

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-28">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  )
}
