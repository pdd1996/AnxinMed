import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { toUserMessage, updateDisplayName, updatePassword, useAuthStore } from '@anxin/core'
import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordSetRequestSchema,
  UpdateMeRequestSchema,
} from '@anxin/shared'
import { BackLink } from '@/components/layout/BackLink'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

/**
 * 个人资料页（G8 增补 + P1 增补「登录密码」）：
 * - 姓名：读/写 users.name，保存后回「我的」；
 * - 登录密码：手机号验证码注册的账号默认无密码，这里补设（账号名自动取手机号，之后可用
 *   「手机号 + 密码」登录）；已有密码的账号改密必须验证当前密码（与 API 同一契约）。
 *
 * 校验走 shared 的 `UpdateMeRequestSchema` / `PasswordSetRequestSchema`（与服务端同一份契约），
 * 客户端先给逐字段中文提示，服务端仍是最终裁决。失败留在本页内联展示（不静默当已保存）。
 * demo 模式没有真实账号，密码区不渲染。
 */
export default function Account() {
  const navigate = useNavigate()
  const authMode = useAuthStore((s) => s.mode)
  const user = useAuthStore((s) => s.user)

  // 姓名
  const [name, setName] = useState(user?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 登录密码
  const hasPassword = user?.hasPassword === true
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const trimmed = name.trim()
  const unchanged = trimmed === (user?.name ?? '')

  async function handleSave() {
    const parsed = UpdateMeRequestSchema.safeParse({ name })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '姓名格式不正确')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await updateDisplayName(parsed.data.name)
      toast.success('姓名已更新')
      navigate('/profile')
    } catch (err) {
      // 失败必须可见：留在本页，表单下方给出中文原因（不静默回退成“已保存”）。
      setError(toUserMessage(err, '保存失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  async function handlePasswordSave() {
    const parsed = PasswordSetRequestSchema.safeParse({
      ...(hasPassword ? { oldPassword } : {}),
      password: newPassword,
    })
    if (!parsed.success) {
      setPasswordError(parsed.error.issues[0]?.message ?? '密码格式不正确')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致')
      return
    }
    setPasswordError(null)
    setSavingPassword(true)
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
      setPasswordError(toUserMessage(err, '保存失败，请重试'))
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="space-y-4">
      <BackLink />

      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">个人资料</p>
        <h1 className="mt-2 text-2xl font-bold">姓名</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          「我的」页和医生端都显示这个名字，随时可以改。
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
            <div className="space-y-2">
              <label htmlFor="display-name" className="block text-sm font-semibold">
                姓名
              </label>
              <Input
                id="display-name"
                value={name}
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                autoComplete="name"
                autoFocus
                placeholder="如：张某某"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'display-name-error' : undefined}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(null)
                }}
              />
              <p className="text-xs text-muted-foreground">最多 {DISPLAY_NAME_MAX_LENGTH} 个字</p>
              {error ? (
                <p id="display-name-error" role="alert" className="text-sm font-medium text-destructive">
                  {error}
                </p>
              ) : null}
            </div>

            <Button type="submit" className="min-h-12 w-full text-base" disabled={saving || unchanged}>
              {saving ? '正在保存…' : '保存'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {authMode === 'demo' ? null : (
        <>
          <div className="pt-2">
            <h2 className="text-2xl font-bold">登录密码</h2>
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
                  void handlePasswordSave()
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
                        setPasswordError(null)
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
                    aria-invalid={passwordError ? true : undefined}
                    aria-describedby={passwordError ? 'password-error' : undefined}
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.target.value)
                      setPasswordError(null)
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
                      setPasswordError(null)
                    }}
                  />
                </div>

                {passwordError ? (
                  <p id="password-error" role="alert" className="text-sm font-medium text-destructive">
                    {passwordError}
                  </p>
                ) : null}

                <Button type="submit" className="min-h-12 w-full text-base" disabled={savingPassword}>
                  {savingPassword ? '正在保存…' : hasPassword ? '修改密码' : '设置密码'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
