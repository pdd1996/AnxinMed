import { ChevronRight, KeyRound, Type } from 'lucide-react'
import { Link } from 'react-router'
import { useAuthStore } from '@anxin/core'
import { useFontScale, type FontScale } from '@/stores/fontScale'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { RiskBadge } from '@/components/domain/RiskBadge'

/**
 * 设置页（M1-T8 起可用）：承载字号两档切换（T8 完成标准的验证入口）+ 风险语义色预览。
 * 字号档经 zustand persist 记忆，切换即时写入 <html data-scale>（见 FontScaleSync）。
 * 「退出登录」按信息层级留在「我的」页底部（账号级动作，不属于设置项）；
 * P1 起「登录密码」入口在本页「账号与安全」区（密码是安全设置，不放进个人资料页）。
 */
export default function Settings() {
  const scale = useFontScale((s) => s.scale)
  const setScale = useFontScale((s) => s.setScale)
  const toggle = useFontScale((s) => s.toggle)
  const authMode = useAuthStore((s) => s.mode)
  const hasPassword = useAuthStore((s) => s.user?.hasPassword === true)

  return (
    <PlaceholderPage title="设置" route="/settings" milestone="M1-T8（字号档已可用）" backTo="/profile">
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

        {/* P1：账号与安全（密码管理入口；demo 模式没有真实账号，不显示）。 */}
        {authMode === 'demo' ? null : (
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <KeyRound className="size-5 text-primary" aria-hidden />
              账号与安全
            </h2>
            <p className="text-sm text-muted-foreground">
              登录密码用于「密码登录」；手机号验证码登录不受影响。
            </p>
            <Link
              to="/settings/password"
              className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 transition-colors hover:bg-muted/50"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <KeyRound className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">登录密码</span>
                <span className="block text-xs text-muted-foreground">
                  {hasPassword ? '已设置，可修改' : '手机号账号还没有密码'}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
            <Type className="size-5 text-primary" aria-hidden />
            风险语义色预览
          </h2>
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
