import { OctagonXIcon, PhoneIcon, MapPinIcon } from 'lucide-react'
import type { ConsultSections } from '@anxin/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * L4 急救引导卡（M3-T2 · PRD §7.5.1）——守门命中紧急信号（胸痛/呼吸困难/意识异常等）时置顶渲染。
 *
 * 老年向原则：
 * - 大按钮 + 图标 + 文字并用（不单靠颜色传达风险，技术方案 §8 / §11）；
 * - "立即拨打 120" 为 tel: 链接（移动端一键拨号）；
 * - 文案照搬后端 EMERGENCY_SECTIONS（demo/server/index.js:947-960 已实测），前端不二次加工。
 *
 * ⚠️ 本卡渲染时 `blocked=true`，前端应隐藏常规回答区（sections/nextAction 已含在本卡内）。
 */
export function EmergencyCard({ sections }: { sections: ConsultSections }) {
  return (
    <Card className="border-risk-l4/50 bg-risk-l4/5 shadow-lg">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <OctagonXIcon className="size-8 shrink-0 text-risk-l4" aria-hidden />
          <div className="flex-1 space-y-1">
            <h2 className="text-lg font-bold text-risk-l4">紧急风险提示</h2>
            <p className="text-sm font-medium text-foreground">{sections.summary}</p>
          </div>
        </div>

        {sections.risks.length > 0 && (
          <ul className="space-y-1 rounded-md border border-risk-l4/30 bg-risk-l4/10 p-3 text-sm text-foreground">
            {sections.risks.map((r) => (
              <li key={r} className="flex items-start gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-risk-l4" aria-hidden />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <Button asChild size="lg" className="w-full min-h-14 text-base font-bold">
            <a href="tel:120">
              <PhoneIcon className="size-5" aria-hidden />
              立即拨打 120
            </a>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full min-h-12">
            <a href="https://map.baidu.com/search/急诊" target="_blank" rel="noreferrer">
              <MapPinIcon className="size-4" aria-hidden />
              查找附近急诊
            </a>
          </Button>
        </div>

        <p className="text-sm font-medium text-foreground">{sections.nextAction}</p>
        <p className="text-xs text-muted-foreground">{sections.warning}</p>
      </CardContent>
    </Card>
  )
}
