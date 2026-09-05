import { useParams } from 'react-router'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default function Draft() {
  // 动态路由参数：验证 /drafts/:id 解析正常。
  const { id } = useParams<{ id: string }>()
  return (
    <PlaceholderPage title="草稿确认页" route={`/drafts/${id ?? ':id'}`} milestone="M2">
      <p>
        当前草稿 ID：
        <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{id}</code>
        （动态路由参数解析正常）。
      </p>
      <p>
        原文对照 + 逐项核对 + 确认生效事务（单事务写 drugs / plans / sources / health）在 M2 实现
        （GET /api/drafts/:id、POST /api/drafts/:id/confirm）。凡进档案，最后一道门是用户。
      </p>
    </PlaceholderPage>
  )
}
