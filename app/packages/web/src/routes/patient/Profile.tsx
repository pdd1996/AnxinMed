import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default function Profile() {
  return (
    <PlaceholderPage title="我的" route="/profile" milestone="M1-T9">
      <p>
        健康信息（字段级来源标「用户自述」）、设置入口、医疗免责声明。
        T9 接 GET / PATCH /api/profile（health_profiles 按字段读写）。
      </p>
    </PlaceholderPage>
  )
}
