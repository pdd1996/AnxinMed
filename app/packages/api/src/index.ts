/**
 * API 进程入口 —— 仅负责启动 HTTP 服务（app 组装在 app.ts，便于 app.request() 测试）。
 */
import { serve } from '@hono/node-server'
import { app } from './app.js'

const port = Number(process.env.PORT ?? 8787)

console.log(`[api] 安心用药 API 启动：http://localhost:${port}`)
serve({ fetch: app.fetch, port })
