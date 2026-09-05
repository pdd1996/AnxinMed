import { Link, Outlet } from 'react-router'
import { Stethoscope } from 'lucide-react'

/**
 * 医生端外壳（/doctor/* 独立分支）：无底部导航，宽屏容器 + 返回患者端入口。
 * 真实洞察内容在 M3（Agent 读库）。
 */
export function DoctorLayout() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Stethoscope className="size-6" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                医生端 · 独立分支
              </p>
              <h1 className="text-xl font-bold">用药洞察</h1>
            </div>
          </div>
          <Link
            to="/"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            返回患者端
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
