import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { signIn, signOut, toUserMessage, useAuthStore } from '@anxin/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Stethoscope } from 'lucide-react'

const DOCTOR_HOME = '/doctor/insight'

/**
 * 医生端专用登录入口（specs/25 · `/doctor/login`）。
 *
 * 为什么单独一页：
 * - 医生与患者共用同一套账号体系，但入口与心智不同——医生端链接 `/doctor/insight` 直接分享时，
 *   医生应落到「医生端登录」而不是患者端登录页；
 * - 登录成功后**服务端角色**决定能否进入：非 doctor 账号即使密码正确也会被挡回本页并提示
 *   「该账号不是医生账号」，不依赖前端隐藏入口（权限判定以服务端 403 兜底）；
 * - demo 模式（AUTH_MODE=demo）已自动注入 p-001，直接跳医生端（保持既有演示行为）。
 *
 * 与患者端 /login 的关系：同一登录 API、同一 token 存储；医生在任意一页登录后都可进入医生端。
 */
export default function DoctorLogin() {
  const status = useAuthStore((s) => s.status)
  const mode = useAuthStore((s) => s.mode)
  const user = useAuthStore((s) => s.user)
  const location = useLocation()
  const state = location.state as { from?: string; reason?: string } | null
  const from = state?.from ?? DOCTOR_HOME

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // 已登录的医生（或 demo 模式）直接进医生端；已登录的患者账号停留在本页等待换号登录。
  if (status === 'authenticated' && (mode === 'demo' || user?.role === 'doctor')) {
    return <Navigate to={from} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const account = username.trim()
    if (!account || !password) {
      setError('请输入医生账号和密码')
      return
    }
    setPending(true)
    setError(null)
    try {
      await signIn(account, password)
      // signIn 已把用户写入 store；此处用最新状态再判角色（非医生 → 立即登出并留在本页）。
      const latest = useAuthStore.getState()
      if (latest.user?.role !== 'doctor') {
        await signOut()
        setError('该账号不是医生账号，请使用医生账号登录')
        return
      }
      // 角色通过 → store 切 authenticated，本组件重渲染为 <Navigate to={from}>。
    } catch (err) {
      setError(toUserMessage(err, '登录失败，请稍后重试'))
    } finally {
      setPending(false)
    }
  }

  const notDoctorHint =
    state?.reason === 'not-doctor' && user && user.role !== 'doctor'
      ? `当前登录账号（${user.name ?? user.username ?? user.id}）不是医生账号，请使用医生账号登录。`
      : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <Card>
          <CardHeader>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">
              <Stethoscope className="size-4" aria-hidden />
              安心用药 · 医生端
            </p>
            <CardTitle className="text-2xl">医生登录</CardTitle>
            <CardDescription className="text-base leading-7">
              仅限医生账号。登录后可查看已授权患者的用药与打卡情况。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              <div className="space-y-2">
                <Label htmlFor="doctor-username" className="text-base">
                  医生账号
                </Label>
                <Input
                  id="doctor-username"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="min-h-12 text-lg"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={pending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="doctor-password" className="text-base">
                  密码
                </Label>
                <Input
                  id="doctor-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  className="min-h-12 text-lg"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={pending}
                />
              </div>

              {(error ?? notDoctorHint) ? (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-base text-destructive">
                  {error ?? notDoctorHint}
                </p>
              ) : null}

              <Button type="submit" className="min-h-12 w-full text-base" disabled={pending}>
                {pending ? '正在登录…' : '登录医生端'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          我是患者，
          <Link to="/login" className="font-semibold text-primary underline underline-offset-4">
            去患者端登录
          </Link>
        </p>
      </div>
    </div>
  )
}
