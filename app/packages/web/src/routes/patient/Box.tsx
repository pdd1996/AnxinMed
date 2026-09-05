import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default function Box() {
  return (
    <PlaceholderPage title="药箱" route="/box" milestone="M1-T9">
      <p>
        药卡（身份快照 + 确认状态徽章 + 库存 + 开封 / 效期提示）、手动建档与手动建 / 编辑计划弹窗，
        将在 T9 接 /api/drugs、/api/plans。
      </p>
    </PlaceholderPage>
  )
}
