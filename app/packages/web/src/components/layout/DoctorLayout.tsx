import { useState } from 'react'
import { Link, Outlet } from 'react-router'
import { signOut, toUserMessage, useAuthStore } from '@anxin/core'
import { LogOut, Stethoscope } from 'lucide-react'

/**
 * 医生端外壳（/doctor/* 独立分支）：无底部导航，宽屏容器 + 当前医生 / 退出登录。
 *
 * 账号区仅在 password 模式显示（demo 模式注入的是演示用户 p-001，没有真实医生身份）；
 * 退出登录后 RequireAuth 会把路由导回 /doctor/login（医生端登录入口，specs/25）。
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
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
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

          <div className="flex items-center gap-3">
            {isRealDoctor && (
              <span className="text-sm text-muted-foreground">
                医生：<span className="font-semibold text-foreground">{user.name ?? user.username ?? user.id}</span>
              </span>
            )}
            {isRealDoctor && (
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={pending}
                className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
              >
                <LogOut className="size-4" aria-hidden />
                {pending ? '正在退出…' : '退出登录'}
              </button>
            )}
            <Link
              to="/"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              返回患者端
            </Link>
          </div>
        </div>
        {error && (
          <p role="alert" className="mx-auto w-full max-w-5xl px-6 pb-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
