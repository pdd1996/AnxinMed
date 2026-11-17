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
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ERR_CODES } from '@anxin/shared'
import type { AppEnv } from './types.js'
import { ApiError } from './lib/http.js'
import { logApiError } from './lib/observability/error-log.js'
import { ipRateLimit, llmRateLimit } from './lib/observability/rate-limit.js'
import { withScenario } from './lib/ai/scenario.js'
import { aiCallLog } from './lib/ai/fixtures.js'
import { requestIdMiddleware } from './middleware/requestId.js'
import { resolveUser } from './middleware/resolveUser.js'
import { observabilitySummaryHandler } from './routes/observability.js'
import { healthHandler } from './routes/health.js'
import { authRoute } from './routes/auth.js'
import { drugsRoute } from './routes/drugs.js'
import { plansRoute } from './routes/plans.js'
import { tasksRoute } from './routes/tasks.js'
import { recordsRoute } from './routes/records.js'
import { profilesRoute } from './routes/profiles.js'
import { intakeRoute } from './routes/intake.js'
import { draftsRoute } from './routes/drafts.js'
import { consultRoute } from './routes/consult.js'
import { insightRoute } from './routes/insight.js'
import { registerStubs } from './routes/_stubs.js'

export const app = new Hono<AppEnv>()

app.use(logger())
// G10：请求级追踪 id（c.set('requestId') + 响应头 x-request-id；错误日志用同一 id 串联）。
app.use('*', requestIdMiddleware)
// G10：IP 兜底限流（/api/*，/api/health 豁免；NODE_ENV=test 默认关闭，RL_FORCE=1 强制开启）。
app.use('/api/*', ipRateLimit)
app.use('/api/*', bodyLimit({ maxSize: 22 * 1024 * 1024 })) // 22mb：容纳拍照上传

if (process.env.NODE_ENV === 'production') {
  // prod：托管前端静态产物（web/dist）。
  // SPA 深链兜底：无扩展名且非 /api 的路径一律回 index.html，否则子页刷新/直链全 404（/box、/doctor/insight…）。
  // 两条排除各有必要：/api 前缀放行——打错的接口要拿 404 JSON，不能被 index.html 的 200 吞掉（失败必须可见）；
  // 带扩展名放行——/assets/*.js|css 等真实文件按原路径命中。
  app.use(
    '/*',
    serveStatic({
      root: './packages/web/dist',
      rewriteRequestPath: (path) =>
        path.startsWith('/api') || /\.[a-z0-9]+$/i.test(path) ? path : '/index.html',
    }),
  )
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
// 顺序即语义：健康检查 + 认证路由在 resolveUser 之前（公开，auth 自行解析凭据），
// 其余 /api/* 经守卫（AUTH_MODE=demo 注入 p-001；password 模式解析 Bearer token）。
// G10 观测端点同样在 resolveUser 之前：它用独立 x-obs-token 鉴权，不需要用户登录。
// .get/.use/.route 运行时均返回同一 app 实例，故 export const app 与集成测试 app.request() 不受影响。
const route = app
  .get('/api/health', healthHandler)
  // G10：观测快照（OBS_ADMIN_TOKEN 未设置 → 404；token 错 → 401；正确 → 200 + data）。
  .get('/api/observability/summary', observabilitySummaryHandler)
  .route('/api/auth', authRoute)
  .use('/api/*', resolveUser)
  // G10：LLM 路由按 userId 限流（必须在 resolveUser 之后才能取 user；非 LLM 路径直接放行）。
  .use('/api/*', llmRateLimit)
  .route('/api/drugs', drugsRoute)
  .route('/api/plans', plansRoute)
  .route('/api/tasks', tasksRoute)
  .route('/api/records', recordsRoute)
  .route('/api/profile', profilesRoute)
  .route('/api/intake', intakeRoute)
  .route('/api/drafts', draftsRoute)
  .route('/api/consult', consultRoute)
  .route('/api/insight', insightRoute)

/** RPC 类型出口：web 端 `import type { AppType } from '@anxin/api'` 获得端到端类型。 */
export type AppType = typeof route

// 其余 M2/M3 路由骨架（501 占位，不进 AppType；web 本期不调用）。registerStubs 收基类 Hono<AppEnv>，故传 app。
registerStubs(app)

// notFound / onError 挂在 route（=== app 同一实例）上，令 route 作为值被使用（供 AppType 类型导出）。
route.notFound((c) => c.json({ ok: false, code: ERR_CODES.NOT_FOUND, message: '路由不存在' }, 404))

/**
 * G10：把 onError 的未处理错误写 JSONL（只记结构化元数据，绝不含请求体/用户问题/模型输出/PII；
 * path 取 pathname 不含 query）。5xx 才落盘：4xx 是业务正常失败路径（响应本身已可见），
 * 全量落 4xx 会淹没真正的错误面。落盘失败只 console.error，不影响错误响应。
 */
function recordRequestError(err: unknown, c: Context<AppEnv>, code: string, status: number): void {
  try {
    logApiError({
      event: 'request_error',
      code,
      status,
      method: c.req.method,
      path: c.req.path,
      requestId: c.get('requestId') || '-',
      errorName: err instanceof Error ? err.name : 'NonError',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
  } catch (logErr) {
    console.error('[api:error] 错误日志落盘失败：', logErr instanceof Error ? logErr.message : logErr)
  }
}

// 全局错误出口：统一 { ok:false, code, message }；日志不打用户数据（执行总纲 §0.5 / §3.2）
route.onError((err, c) => {
  // 错误响应也带 x-request-id，便于与 JSONL 错误日志逐条对上。
  const requestId = c.get('requestId')
  if (requestId) c.header('x-request-id', requestId)

  if (err instanceof ApiError) {
    if (err.status >= 500) recordRequestError(err, c, err.code, err.status)
    return c.json({ ok: false, code: err.code, message: err.message, ...(err.details ?? {}) }, err.status)
  }
  if (err instanceof HTTPException) {
    if (err.status >= 500) recordRequestError(err, c, 'INTERNAL', err.status)
    return c.json({ ok: false, code: ERR_CODES.VALIDATION, message: err.message }, err.status as ContentfulStatusCode)
  }
  console.error('[api:error]', err.name, err.message)
  recordRequestError(err, c, 'INTERNAL', 500)
  return c.json({ ok: false, code: 'INTERNAL', message: '服务器内部错误' }, 500)
})
