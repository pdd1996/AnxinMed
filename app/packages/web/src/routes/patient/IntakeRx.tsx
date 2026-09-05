import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default function IntakeRx() {
  return (
    <PlaceholderPage title="拍处方笺录入" route="/intake/rx" milestone="M2">
      <p>
        入口 A：层检测 → 医嘱线管线七步 → 草稿确认页。M2 实现（POST /api/intake/prescription）。
        本期先放占位，底部导航「录入」可到达此页。
      </p>
    </PlaceholderPage>
  )
}
