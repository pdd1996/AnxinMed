import { APP_NAME } from '@anxin/shared'

/**
 * M1-T2 脚手架占位页：验证 @anxin/shared 跨包导入 + Vite 对 shared 源码的转译。
 * M1-T8 起用 react-router + shadcn/ui + 老年向设计令牌重写为真实路由骨架。
 */
export default function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', lineHeight: 1.7 }}>
      <h1>{APP_NAME}</h1>
      <p>M1-T2 前端脚手架已就绪：Vite + React 19 + TypeScript。</p>
      <p>
        跨包导入验证：<code>@anxin/shared</code> → <code>APP_NAME = "{APP_NAME}"</code> ✅
      </p>
    </main>
  )
}
