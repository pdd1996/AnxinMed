import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default function Home() {
  return (
    <PlaceholderPage title="今日任务" route="/" milestone="M1-T9">
      <p>
        今日服药任务卡（药名 / 规格 / 时间 / 状态）、已服 / 稍后 / 跳过、二次确认拦截与提醒弹窗，
        将在 T9 接真 API（GET /api/tasks/today、POST /api/records）。
      </p>
    </PlaceholderPage>
  )
}
