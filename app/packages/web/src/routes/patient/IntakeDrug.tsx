import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default function IntakeDrug() {
  return (
    <PlaceholderPage title="拍药品录入" route="/intake/drug" milestone="M2">
      <p>
        入口 B：身份线三项严格匹配（药名 + 规格 + 剂型）→ 建档草稿。
        贴标药盒仅建档 + 提示、不抄录标签（PRD V2.1）。M2 实现（POST /api/intake/drug）。
      </p>
    </PlaceholderPage>
  )
}
