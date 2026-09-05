import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default function Insight() {
  return (
    <PlaceholderPage title="患者用药洞察" route="/doctor/insight" milestone="M3">
      <p>
        医生端 Agent：5 只读工具 → LLM 组装摘要，跨患者依从 / 风险 / 效期洞察。
        M3 实现（GET /api/insight/patients、POST /api/insight/summary）。此分支为独立外壳，无底部导航。
      </p>
    </PlaceholderPage>
  )
}
