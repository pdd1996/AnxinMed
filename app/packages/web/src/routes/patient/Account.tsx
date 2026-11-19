import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { toUserMessage, updateDisplayName, useAuthStore } from '@anxin/core'
import { DISPLAY_NAME_MAX_LENGTH, UpdateMeRequestSchema } from '@anxin/shared'
import { BackLink } from '@/components/layout/BackLink'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

/**
 * 个人资料页（G8 增补）：只承载「身份资料」——当前是姓名，头像以后加在同一页。
 *
 * 登录密码不在这里：密码是安全设置，入口在「我的 → 登录密码」（2026-11-19 从「设置 → 账号与安全」上移）。
 *
 * 头像不在这里——它涉及存储选型（本地磁盘 / 对象存储 / 入库 base64）与上传大小、类型白名单，
 * 需要单独立项；本页先把「名字」这条读+写链路打通。
 *
 * 校验走 shared 的 `UpdateMeRequestSchema`（与服务端同一份契约）：同一规则不前后端各写一遍，
 * 客户端先给逐字段中文提示，服务端仍是最终裁决（非法值 → 400 VALIDATION）。
 * 保存成功后返回「我的」：头部直接读登录态 store，回去就能看到新名字。
 */
export default function Account() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [name, setName] = useState(user?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="space-y-4">
      <BackLink />
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">个人资料</p>
        <h1 className="mt-2 text-2xl font-bold">姓名</h1>
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
    </div>
  )
}
