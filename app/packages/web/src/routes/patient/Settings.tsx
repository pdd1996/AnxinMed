import { useState } from 'react'
import { Type, User } from 'lucide-react'
import { signOut, useAuthStore } from '@anxin/core'
import { useFontScale, type FontScale } from '@/stores/fontScale'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { RiskBadge } from '@/components/domain/RiskBadge'
import { Card, CardContent } from '@/components/ui/card'

/**
 * 设置页（M1-T8 起可用）：承载字号两档切换（T8 完成标准的验证入口）+ 风险语义色预览。
 * 字号档经 zustand persist 记忆，切换即时写入 <html data-scale>（见 FontScaleSync）。
 */
export default function Settings() {
  const scale = useFontScale((s) => s.scale)
  const setScale = useFontScale((s) => s.setScale)
  const toggle = useFontScale((s) => s.toggle)

  // 登录态（G7）：demo 模式显示旁路说明；password 模式显示当前账号 + 退出。
  const authMode = useAuthStore((s) => s.mode)
  const user = useAuthStore((s) => s.user)
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      // 退出后 status=anonymous，RequireAuth 自动跳 /login；这里无需手动导航。
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <PlaceholderPage title="设置" route="/settings" milestone="M1-T8（字号档已可用）">
      <div className="space-y-7">
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
            <Type className="size-5 text-primary" aria-hidden />
            字号大小
          </h2>
          <p className="text-sm text-muted-foreground">
            两档切换，即时生效并记住你的选择（刷新后保持）。当前：
            <strong className="text-foreground">{scale === 'large' ? '大字' : '标准'}</strong>
          </p>
          <Tabs value={scale} onValueChange={(v) => setScale(v as FontScale)}>
            <TabsList>
              <TabsTrigger value="normal" className="min-h-11 px-6">
                标准
              </TabsTrigger>
              <TabsTrigger value="large" className="min-h-11 px-6">
                大字
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" className="min-h-11" onClick={toggle}>
            切换字号档
          </Button>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
            <User className="size-5 text-primary" aria-hidden />
            账号
          </h2>
          {authMode === 'demo' ? (
            <p className="text-sm leading-6 text-muted-foreground">
              演示模式：当前免登录，数据归属演示用户 <strong className="text-foreground">p-001</strong>。
              正式验收环境会要求账号密码登录。
            </p>
          ) : (
            <Card>
              <CardContent className="space-y-3 pt-0">
                <p className="text-sm leading-6 text-muted-foreground">
                  当前登录：
                  <strong className="text-foreground">{user?.name ?? user?.username ?? '—'}</strong>
                  {user?.username ? <span className="text-muted-foreground">（{user.username}）</span> : null}
                </p>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                >
                  {signingOut ? '正在退出…' : '退出登录'}
                </Button>
              </CardContent>
            </Card>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-bold text-foreground">风险语义色预览</h2>
          <p className="text-sm text-muted-foreground">
            图标 + 文字并用，不单靠颜色（守门 L1–L4，L4 最高）。
          </p>
          <div className="flex flex-wrap gap-2">
            <RiskBadge level="L1" />
            <RiskBadge level="L2" />
            <RiskBadge level="L3" />
            <RiskBadge level="L4" />
          </div>
        </section>
      </div>
    </PlaceholderPage>
  )
}
