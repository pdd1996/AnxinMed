import { Type } from 'lucide-react'
import { useFontScale, type FontScale } from '@/stores/fontScale'
import { BackLink } from '@/components/layout/BackLink'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * 设置页（M1-T8 起可用）：字号两档切换 —— 全局缩放的验证入口。
 * 字号档经 zustand persist 记忆，切换即时写入 <html data-scale>（见 FontScaleSync）。
 * 「退出登录」按信息层级留在「我的」页底部（账号级动作，不属于设置项）；
 * 「登录密码」自 2026-11-19 起与「绑定医生」一样上移到「我的」页（入口太深，老人找不到），
 * 本页只剩字号这类真正的设置项，不再有「账号与安全」区块。
 * 「风险语义色预览」是设计自检项、不是用户设置，已从患者界面移除。
 */
export default function Settings() {
  const scale = useFontScale((s) => s.scale)
  const setScale = useFontScale((s) => s.setScale)

  return (
    <div className="space-y-7">
      <BackLink to="/profile" />
      <h1 className="text-2xl font-bold">设置</h1>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          <Type className="size-5 text-primary" aria-hidden />
          字号大小
        </h2>
        <p className="text-sm text-muted-foreground">切换后立即生效，刷新页面仍保持。</p>
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
      </section>
    </div>
  )
}
