import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { PHONE_PATTERN } from '@anxin/shared'
import {
  requestPhoneCode,
  signIn,
  signInWithPhone,
  toUserMessage,
  useAuthStore,
} from '@anxin/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type LoginTab = 'password' | 'phone'

/**
 * 登录页（G7 账号密码 · P1 手机号验证码）——适老化：大字、大触控目标、错误文案内联可见。
 *
 * - 已登录访问 → 回原页（state.from）或首页；
 * - demo 模式不会出现本页（/api/auth/me 直接返回 p-001，路由守卫放行）；
 * - 两种方式并存：老账号继续用管理员分配的账号密码；手机号验证码为「验证码即注册」
 *   （未注册手机号验码通过后自动建号），成功/失败文案都由服务端中文 message 直接透传，
 *   网络/超时/服务异常统一经 core 的 toUserMessage 归成中文（G8，禁止 Failed to fetch 原样上屏）；
 * - 无自助改密/找回：密码账号由 CLI 开通，忘记密码走管理员重置（G7 已知边界）。
 */
export default function Login() {
  const status = useAuthStore((s) => s.status)
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [tab, setTab] = useState<LoginTab>('password')
  const [error, setError] = useState<string | null>(null)

  // 密码登录
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordPending, setPasswordPending] = useState(false)

  // 手机号验证码登录
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [phonePending, setPhonePending] = useState(false)
  /** 重发倒计时（秒），由服务端返回的 cooldownSec 初始化。 */
  const [cooldown, setCooldown] = useState(0)

  // 倒计时：每秒减一（卸载自动清理，避免离开页面后 setState）。
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

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

  function switchTab(next: LoginTab) {
    setTab(next)
    setError(null)
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const account = username.trim()
    if (!account || !password) {
      setError('请输入账号和密码')
      return
    }
    setPasswordPending(true)
    setError(null)
    try {
      await signIn(account, password)
      // 成功后 store 切 authenticated → 本组件重渲染为 <Navigate>，无需手动跳转。
    } catch (err) {
      // 服务端中文 message 原样透传；网络/超时/服务异常等英文技术错误由 core 统一换中文。
      setError(toUserMessage(err, '登录失败，请稍后重试'))
    } finally {
      setPasswordPending(false)
    }
  }

  async function handleSendCode() {
    if (sending || cooldown > 0) return
    const value = phone.trim()
    if (!PHONE_PATTERN.test(value)) {
      setError('请输入 11 位手机号')
      return
    }
    setSending(true)
    setError(null)
    try {
      const data = await requestPhoneCode(value)
      setCooldown(data.cooldownSec)
    } catch (err) {
      // SMS_LIMITED / SMS_SEND_FAILED / SMS_NOT_CONFIGURED 的中文 message 原样透传。
      setError(toUserMessage(err, '验证码发送失败，请稍后重试'))
    } finally {
      setSending(false)
    }
  }

  async function handlePhoneSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const phoneValue = phone.trim()
    const codeValue = code.trim()
    if (!PHONE_PATTERN.test(phoneValue)) {
      setError('请输入 11 位手机号')
      return
    }
    if (!/^\d{4,8}$/.test(codeValue)) {
      setError('请输入短信验证码')
      return
    }
    setPhonePending(true)
    setError(null)
    try {
      // 验证码即注册：未注册手机号验码通过后由服务端自动建号并发会话。
      await signInWithPhone(phoneValue, codeValue)
    } catch (err) {
      setError(toUserMessage(err, '登录失败，请稍后重试'))
    } finally {
      setPhonePending(false)
    }
  }

  const tabButton = (key: LoginTab, label: string) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => switchTab(key)}
      className={cn(
        'min-h-11 rounded-md px-3 text-base font-medium transition-colors',
        tab === key
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">登录安心用药</CardTitle>
          <CardDescription className="text-base leading-7">请选择登录方式</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="tablist" aria-label="登录方式" className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {tabButton('password', '密码登录')}
            {tabButton('phone', '手机号登录')}
          </div>

          {tab === 'password' ? (
            <form className="space-y-5" onSubmit={handlePasswordSubmit} noValidate>
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
                  disabled={passwordPending}
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
                  disabled={passwordPending}
                />
              </div>

              {error ? (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-base text-destructive">
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="min-h-12 w-full text-base" disabled={passwordPending}>
                {passwordPending ? '正在登录…' : '登录'}
              </Button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={handlePhoneSubmit} noValidate>
              <div className="space-y-2">
                <Label htmlFor="login-phone" className="text-base">
                  手机号
                </Label>
                <Input
                  id="login-phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={11}
                  placeholder="请输入 11 位手机号"
                  className="min-h-12 text-lg"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  disabled={phonePending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="login-code" className="text-base">
                  短信验证码
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="login-code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    placeholder="请输入验证码"
                    className="min-h-12 flex-1 text-lg"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    disabled={phonePending}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12 shrink-0 px-4 text-base"
                    onClick={() => void handleSendCode()}
                    disabled={sending || cooldown > 0 || phonePending}
                  >
                    {sending ? '发送中…' : cooldown > 0 ? `${cooldown} 秒后重发` : '获取验证码'}
                  </Button>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  未注册的手机号验证通过后将自动创建账号。
                </p>
              </div>

              {error ? (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-base text-destructive">
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="min-h-12 w-full text-base" disabled={phonePending}>
                {phonePending ? '正在登录…' : '登录 / 注册'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
