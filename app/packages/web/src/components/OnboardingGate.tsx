import { useState, type ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const KEY = 'anxin-onboarded'

/**
 * 首次使用引导（PRD §7.1.1）：展示产品能力边界与医疗免责声明，确认后才进入。
 * 仅前端状态：localStorage 记「已确认」，刷新不再弹出。
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const [confirmed, setConfirmed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem(KEY) === '1'
  })

  if (confirmed) return <>{children}</>

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldAlert className="size-6" aria-hidden />
          </div>
          <CardTitle className="text-xl">欢迎使用安心用药</CardTitle>
          <CardDescription>首次使用前，请了解产品能力边界与免责声明。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <ul className="list-disc space-y-2 pl-5">
            <li>本工具帮你把各来源的药放进同一个药箱，管理依从、相互作用提示与效期。</li>
            <li>
              它<b className="text-foreground">不做诊断</b>
              、不替代医生或药师；所有用药决定请以医嘱与说明书为准。
            </li>
            <li>AI 回答仅基于已确认的说明书资料；涉及停换药或剂量调整会建议你咨询医生。</li>
            <li>提醒仅在页面打开期间生效；漏服不会自动建议补服。</li>
          </ul>
          <Button
            className="min-h-11 w-full"
            onClick={() => {
              localStorage.setItem(KEY, '1')
              setConfirmed(true)
            }}
          >
            我已了解并同意
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
