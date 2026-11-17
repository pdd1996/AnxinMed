/**
 * API 进程入口 —— 仅负责启动 HTTP 服务（app 组装在 app.ts，便于 app.request() 测试）。
 *
 * G10：进程级致命错误先落 JSONL（uncaughtException / unhandledRejection），
 * 再保持 Node 既有「失败可见」语义 —— 打印并退出码非 0，绝不吞掉后继续裸奔。
 */
import { serve } from '@hono/node-server'
import { app } from './app.js'
import { logProcessError } from './lib/observability/error-log.js'

// 供 web 端 `import type { AppType } from '@anxin/api'` 获得 hc 端到端类型（type-only，构建期擦除，不会触发 serve/db）。
export type { AppType } from './app.js'

process.on('uncaughtException', (err) => {
  logProcessError('uncaught_exception', err)
  console.error('[api:fatal] uncaughtException：', err)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logProcessError('unhandled_rejection', reason)
  console.error('[api:fatal] unhandledRejection：', reason)
  process.exit(1)
})

const port = Number(process.env.PORT ?? 8787)

console.log(`[api] 安心用药 API 启动：http://localhost:${port}`)
serve({ fetch: app.fetch, port })
