import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { signIn, toUserMessage, useAuthStore } from '@anxin/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * 登录页（G7 · 账号密码）——适老化：大字、大触控目标、错误文案内联可见。
 *
 * - 已登录访问 → 回原页（state.from）或首页；
 * - demo 模式不会出现本页（/api/auth/me 直接返回 p-001，路由守卫放行）；
 * - 失败文案优先用服务端返回（账号或密码错误 / 登录尝试次数过多…）；网络/超时/服务异常
 *   等技术错误统一经 core 的 toUserMessage 归成中文（G8，禁止把 Failed to fetch 原样上屏）；
 * - 无自助注册/找回：账号由 CLI 开通，忘记密码走管理员重置（G7 已知边界）。
 */
export default function Login() {
  const status = useAuthStore((s) => s.status)
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-base text-muted-foreground">正在检查登录状态…</p>
      </div>
    )
  }
  if (status === 'authenticated') {
    return <Navigate to={from} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const account = username.trim()
    if (!account || !password) {
      setError('请输入账号和密码')
      return
    }
    setPending(true)
    setError(null)
    try {
      await signIn(account, password)
      // 成功后 store 切 authenticated → 本组件重渲染为 <Navigate>，无需手动跳转。
    } catch (err) {
      // 服务端中文 message 原样透传；网络/超时/服务异常等英文技术错误由 core 统一换中文。
      setError(toUserMessage(err, '登录失败，请稍后重试'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">登录安心用药</CardTitle>
          <CardDescription className="text-base leading-7">
            请输入管理员分配给你的账号和密码。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="login-username" className="text-base">
                账号
              </Label>
              <Input
                id="login-username"
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
              <Label htmlFor="login-password" className="text-base">
                密码
              </Label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                className="min-h-12 text-lg"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
              />
            </div>

            {error ? (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-base text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="min-h-12 w-full text-base" disabled={pending}>
              {pending ? '正在登录…' : '登录'}
            </Button>

            <p className="text-sm leading-6 text-muted-foreground">
              账号由管理员分配；忘记密码请联系管理员重置。本系统仅用于演示与受控验收，不接收真实患者数据。
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
