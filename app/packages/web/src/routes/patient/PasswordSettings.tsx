import { useState } from 'react'
import { toast } from 'sonner'
import { toUserMessage, updatePassword, useAuthStore } from '@anxin/core'
import { PASSWORD_MIN_LENGTH, PasswordSetRequestSchema } from '@anxin/shared'
import { BackLink } from '@/components/layout/BackLink'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

/**
 * 登录密码页（P1 增补 · 从「个人资料」迁出）：/settings/password，入口在「设置 → 账号与安全」。
 *
 * 为什么独立成二级页而不是塞进个人资料：密码是安全设置，不是身份资料；个人资料只放姓名/头像这类
 * 展示信息。后续手机号换绑、账号注销（G14）、登录设备管理也会进「账号与安全」，独立页留扩展位。
 *
 * 语义：手机号验证码注册的账号默认无密码，这里补设（账号名自动取手机号，之后可用
 * 「手机号 + 密码」登录）；已有密码的账号改密必须验证当前密码（与 API 同一契约）。
 * 校验走 shared 的 `PasswordSetRequestSchema`；失败留在本页内联展示（不静默当已保存）。
 */
export default function PasswordSettings() {
  const user = useAuthStore((s) => s.user)
  const hasPassword = user?.hasPassword === true

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    const parsed = PasswordSetRequestSchema.safeParse({
      ...(hasPassword ? { oldPassword } : {}),
      password: newPassword,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '密码格式不正确')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    setError(null)
    setSaving(true)
    try {
      // 无密码账号（手机号注册）不传旧密码：登录态已证明手机号归属。
      await updatePassword(hasPassword ? oldPassword : undefined, parsed.data.password)
      toast.success(
        hasPassword ? '密码已更新，请使用新密码登录' : '密码已设置，可用「手机号 + 密码」登录',
      )
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(toUserMessage(err, '保存失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <BackLink to="/settings" />
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">账号与安全</p>
        <h1 className="mt-2 text-2xl font-bold">登录密码</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {hasPassword
            ? '修改密码需要先输入当前密码；修改后请用新密码登录，当前登录不会被退出。'
            : '手机号注册的账号还没有密码；设置后可用「手机号作为账号 + 密码」登录。'}
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void handleSave()
            }}
          >
            {hasPassword ? (
              <div className="space-y-2">
                <label htmlFor="current-password" className="block text-sm font-semibold">
                  当前密码
                </label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={oldPassword}
                  onChange={(event) => {
                    setOldPassword(event.target.value)
                    setError(null)
                  }}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <label htmlFor="new-password" className="block text-sm font-semibold">
                新密码
              </label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                placeholder={`至少 ${PASSWORD_MIN_LENGTH} 位`}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'password-error' : undefined}
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value)
                  setError(null)
                }}
              />
              <p className="text-xs text-muted-foreground">至少 {PASSWORD_MIN_LENGTH} 位</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="confirm-password" className="block text-sm font-semibold">
                确认新密码
              </label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value)
                  setError(null)
                }}
              />
            </div>

            {error ? (
              <p id="password-error" role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="min-h-12 w-full text-base" disabled={saving}>
              {saving ? '正在保存…' : hasPassword ? '修改密码' : '设置密码'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
