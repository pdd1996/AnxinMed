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
import { withScenario } from './lib/ai/scenario.js'
import { aiCallLog } from './lib/ai/fixtures.js'
import { resolveUser } from './middleware/resolveUser.js'
import { healthHandler } from './routes/health.js'
import { drugsRoute } from './routes/drugs.js'
import { plansRoute } from './routes/plans.js'
import { tasksRoute } from './routes/tasks.js'
import { recordsRoute } from './routes/records.js'
import { profilesRoute } from './routes/profiles.js'
import { intakeRoute } from './routes/intake.js'
import { draftsRoute } from './routes/drafts.js'
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

// E2E（M2-T10）：fixtures 模式把请求级 x-test-scenario 头放进 AsyncLocalStorage，供 FixtureAiClients 按请求回放；
// 并暴露 fixture 客户端调用计数（「OCR 未调用」等结构断言）。仅 AI_MODE=fixtures 注册，生产/单测不存在。
if (process.env.AI_MODE === 'fixtures') {
  app.use('/api/*', (c, next) => withScenario(c.req.header('x-test-scenario') ?? '', next))
  app.get('/api/_e2e/ai-calls', (c) => c.json({ ok: true, calls: aiCallLog(c.req.query('scenario') ?? '') }))
}

// 单条链式表达式注册路由并导出 AppType（hc<AppType> 端到端类型推导，技术方案 §1）。
// 顺序即语义：健康检查在 resolveUser 之前（公开），其余 /api/* 经守卫（MVP 注入演示用户 p-001）。
// .get/.use/.route 运行时均返回同一 app 实例，故 export const app 与集成测试 app.request() 不受影响。
const route = app
  .get('/api/health', healthHandler)
  .use('/api/*', resolveUser)
  .route('/api/drugs', drugsRoute)
  .route('/api/plans', plansRoute)
  .route('/api/tasks', tasksRoute)
  .route('/api/records', recordsRoute)
  .route('/api/profile', profilesRoute)
  .route('/api/intake', intakeRoute)
  .route('/api/drafts', draftsRoute)

/** RPC 类型出口：web 端 `import type { AppType } from '@anxin/api'` 获得端到端类型。 */
export type AppType = typeof route

// 其余 M2/M3 路由骨架（501 占位，不进 AppType；web 本期不调用）。registerStubs 收基类 Hono<AppEnv>，故传 app。
registerStubs(app)

// notFound / onError 挂在 route（=== app 同一实例）上，令 route 作为值被使用（供 AppType 类型导出）。
route.notFound((c) => c.json({ ok: false, code: ERR_CODES.NOT_FOUND, message: '路由不存在' }, 404))

// 全局错误出口：统一 { ok:false, code, message }；日志不打用户数据（执行总纲 §0.5 / §3.2）
route.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ ok: false, code: err.code, message: err.message, ...(err.details ?? {}) }, err.status)
  }
  if (err instanceof HTTPException) {
    return c.json({ ok: false, code: ERR_CODES.VALIDATION, message: err.message }, err.status as ContentfulStatusCode)
  }
  console.error('[api:error]', err.name, err.message)
  return c.json({ ok: false, code: 'INTERNAL', message: '服务器内部错误' }, 500)
})
