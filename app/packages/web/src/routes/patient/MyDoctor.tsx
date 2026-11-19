import { useAuthStore } from '@anxin/core'
import { PatientBindDoctorCard } from '@/components/domain/PatientBindDoctorCard'
import { BackLink } from '@/components/layout/BackLink'
import { Card, CardContent } from '@/components/ui/card'

/**
 * 「我的医生」独立页（specs/25 患者端入口调整）—— /my-doctor。
 *
 * 为什么把绑定卡片从设置页迁出来：原先它是「设置」页最底部的一张卡，排在「字号大小」
 * 「账号与安全」之后，老年患者要先想到进设置、再滑到页底才可能发现，入口太深；而「绑定医生」
 * 是医患授权的功能性动作，不是字号/密码这类设置项，埋在设置页里语义也不对。改为在「我的」页
 * 给出显式「绑定医生」入口（仅 password 模式），与「健康信息」「服药记录」同级的独立二级页，
 * 设置页只保留真正的设置项，两处不再重复。
 *
 * 模式语义：卡片本身只在 password 模式（真实账号）下渲染——demo 模式固定注入本地模拟用户，
 * 没有真实的医患授权关系；此时本页给一段可见说明，不渲染绑定输入，避免让人误以为可真实绑定。
 */
export default function MyDoctor() {
  const mode = useAuthStore((s) => s.mode)

  return (
    <div className="space-y-4">
      <BackLink to="/profile" />
      <h1 className="text-2xl font-bold">我的医生</h1>

      {mode === 'password' ? (
        <PatientBindDoctorCard />
      ) : (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            演示模式不开启真实医患绑定：绑定码与医生授权需要账号密码登录（AUTH_MODE=password）。
          </CardContent>
        </Card>
      )}
    </div>
  )
}
