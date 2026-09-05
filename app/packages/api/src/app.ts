/**
 * Hono app 组装（技术方案 §1 / 任务书 T5）。
 *
 * 中间件链：logger → bodyLimit(22mb) → cors(dev) | serveStatic(prod) →
 *           GET /api/health（公开） → resolveUser（守卫其余 /api/*） → 路由 → onError
 *
 * app 与 index.ts 分离：本文件只组装并导出 app（供 app.request() 集成测试），
 * index.ts 负责 serve()。否则测试 import 会触发监听端口。
 */
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ERR_CODES } from '@anxin/shared'
import type { AppEnv } from './types.js'
import { ApiError } from './lib/http.js'
import { resolveUser } from './middleware/resolveUser.js'
import { healthHandler } from './routes/health.js'
import { drugsRoute } from './routes/drugs.js'
import { plansRoute } from './routes/plans.js'
import { tasksRoute } from './routes/tasks.js'
import { recordsRoute } from './routes/records.js'
import { registerStubs } from './routes/_stubs.js'

export const app = new Hono<AppEnv>()

app.use(logger())
app.use('/api/*', bodyLimit({ maxSize: 22 * 1024 * 1024 })) // 22mb：容纳拍照上传

if (process.env.NODE_ENV === 'production') {
  // prod：托管前端静态产物（web/dist）。具体 root 路径在 M1-T10 docker 落定。
  app.use('/*', serveStatic({ root: './packages/web/dist' }))
} else {
  // dev：web(5173) 经 vite 代理 /api→8787；放开 CORS 便于直连调试。
  app.use('/api/*', cors())
}

// 公开 infra 路由：健康检查在 resolveUser 之前，不依赖用户解析
app.get('/api/health', healthHandler)

// 其余 /api/* 全部经 resolveUser 守卫（MVP 注入演示用户 p-001）
app.use('/api/*', resolveUser)

// 真实业务路由（T7：药箱 / 计划 / 今日任务 / 服药记录）
app.route('/api/drugs', drugsRoute)
app.route('/api/plans', plansRoute)
app.route('/api/tasks', tasksRoute)
app.route('/api/records', recordsRoute)

// 其余 M2/M3 路由骨架（501 占位）
registerStubs(app)

app.notFound((c) => c.json({ ok: false, code: ERR_CODES.NOT_FOUND, message: '路由不存在' }, 404))

// 全局错误出口：统一 { ok:false, code, message }；日志不打用户数据（执行总纲 §0.5 / §3.2）
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ ok: false, code: err.code, message: err.message }, err.status)
  }
  if (err instanceof HTTPException) {
    return c.json({ ok: false, code: ERR_CODES.VALIDATION, message: err.message }, err.status as ContentfulStatusCode)
  }
  console.error('[api:error]', err.name, err.message)
  return c.json({ ok: false, code: 'INTERNAL', message: '服务器内部错误' }, 500)
})
