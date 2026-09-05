import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export default function Consult() {
  return (
    <PlaceholderPage title="AI 咨询" route="/consult" milestone="M3">
      <p>
        本地说明书库按键取数 + 百川 + 安全守门 L1–L4 + citations。M3 实现（POST /api/consult）。
        语音输入 / 播报失败即降级为文字与按钮，不阻塞主流程。
      </p>
    </PlaceholderPage>
  )
}
