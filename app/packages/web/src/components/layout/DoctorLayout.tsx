import { useState } from 'react'
import { Outlet } from 'react-router'
import { signOut, toUserMessage, useAuthStore } from '@anxin/core'
import { LogOut, Stethoscope } from 'lucide-react'

/**
 * 医生端外壳（/doctor/* 独立分支）：无底部导航，宽屏容器 + 当前医生 / 退出登录。
 *
 * 账号区仅在 password 模式显示（demo 模式注入的是演示用户 p-001，没有真实医生身份）；
 * 退出登录后 RequireAuth 会把路由导回 /doctor/login（医生端登录入口，specs/25）。
 *
 * H5 适配（440px 手机宽度）：头部单行不换行——品牌区可截断、账号名小屏隐藏、
 * 退出登录按钮常驻；不再展示「返回患者端」（医生端独立入口，避免与患者端心智混淆）。
 */
export function DoctorLayout() {
  const mode = useAuthStore((s) => s.mode)
  const user = useAuthStore((s) => s.user)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogout() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await signOut()
    } catch (err) {
      setError(toUserMessage(err, '退出登录失败，请重试'))
    } finally {
      setPending(false)
    }
  }

  const isRealDoctor = mode !== 'demo' && user?.role === 'doctor'

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground sm:size-11">
              <Stethoscope className="size-5 sm:size-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-primary sm:text-xs sm:tracking-[0.18em]">
                医生端
              </p>
              <h1 className="truncate text-lg font-bold sm:text-xl">用药洞察</h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {isRealDoctor && (
              <span className="hidden max-w-[10rem] truncate text-sm text-muted-foreground sm:inline">
                医生：<span className="font-semibold text-foreground">{user.name ?? user.username ?? user.id}</span>
              </span>
            )}
            {isRealDoctor && (
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={pending}
                className="inline-flex min-h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
              >
                <LogOut className="size-4" aria-hidden />
                {pending ? '正在退出…' : '退出'}
              </button>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="mx-auto w-full max-w-5xl px-4 pb-2 text-sm text-destructive sm:px-6">
            {error}
          </p>
        )}
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}
