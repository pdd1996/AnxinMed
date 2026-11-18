/**
 * 咨询路由轨迹（M13-T2 · docs/14 §4 T2；specs/16 T2）——schema + 开发期落盘。
 *
 * 目的：规则路由出错时能回答「哪一层、哪条规则、为什么不命中」，替代盲目读正则。
 * 纪律：
 * - **不含问题原文 / PII**：只记规则 id、枚举、计数、命中关键词（来自守门白名单正则）；
 * - 默认关闭（`CONSULT_ROUTE_TRACE=1` 才写），关闭时零 I/O，不影响骨架 P95；
 * - 落盘失败由调用方可见（console.error），不阻塞主回答。
 *
 * 目录：`CONSULT_ROUTE_TRACE_DIR` 可覆盖（测试用临时目录），默认 `.agent-debug`（已 gitignore）。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

/** trace 结构版本（字段变更时 +1；消费方按版本解析）。v2 = M13-P2 T6 增意图候选/低置信。 */
export const ROUTE_TRACE_VERSION = 2 as const
/** 路由实现版本（改路由规则时 +1，便于回看旧 trace；T6 只观测未改决策，保持 r1）。 */
export const ROUTE_VERSION = 'r1'

export const ROUTE_TRACE_FLAG = 'CONSULT_ROUTE_TRACE'
export const ROUTE_TRACE_DIR_ENV = 'CONSULT_ROUTE_TRACE_DIR'
export const DEFAULT_ROUTE_TRACE_DIR = '.agent-debug'

/** detail 值只允许可安全序列化的结构字段（禁止塞问题原文/用户数据）。 */
export const TraceDetailValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
])

/** 路由轨迹单步：层 + 结果 + 安全 detail。 */
export const RouteTraceStepSchema = z.object({
  layer: z.enum(['input', 'guard', 'object', 'scope', 'intent', 'route', 'execute']),
  outcome: z.string().min(1),
  detail: z.record(z.string(), TraceDetailValueSchema).optional(),
})

/** 一轮咨询的完整路由轨迹。 */
export const RouteTraceSchema = z.object({
  v: z.literal(ROUTE_TRACE_VERSION),
  routeVersion: z.string().min(1),
  consultLogId: z.string().nullable(),
  createdAt: z.string().min(1),
  steps: z.array(RouteTraceStepSchema).min(1),
  finalRoute: z.string().min(1),
  /** 是否走 S1（LLM 路径；降级时仍为 true，实际调用次数看 ai-calls 断言）。 */
  llmPath: z.boolean(),
  status: z.string().nullable(),
  intent: z.string().nullable(),
  /** T6 观测：5 个数据意图的候选分数（空数组 = 守门/快路径/开关关闭；不参与决策）。 */
  intentCandidates: z.array(
    z.object({
      intent: z.string().min(1),
      score: z.number().min(0).max(100),
      reason: z.string(),
    }),
  ),
  /** T6 观测：低置信（top<80 / top2 差≤8 / 解释或行动类仲裁触发）。 */
  lowConfidence: z.boolean(),
  /** T6 观测：低置信原因（定向抽检分组）。 */
  lowConfidenceReason: z.enum(['veto:explain', 'veto:advice', 'top-low', 'margin']).nullable(),
})

export type RouteTraceStep = z.infer<typeof RouteTraceStepSchema>
export type RouteTrace = z.infer<typeof RouteTraceSchema>

/** 开发期 trace 开关（默认关——生产/CI 不写文件）。 */
export function isRouteTraceEnabled(): boolean {
  return process.env[ROUTE_TRACE_FLAG] === '1'
}

/** trace 目录（env 可覆盖，便于测试写临时目录）。 */
export function resolveRouteTraceDir(): string {
  return process.env[ROUTE_TRACE_DIR_ENV] || DEFAULT_ROUTE_TRACE_DIR
}

/**
 * 写一轮路由轨迹。
 * @returns 写入的文件路径；开关关闭时返回 null（零 I/O）。
 * @throws trace 不符合 schema（编码 bug，必须可见）或文件写入失败（由调用方 catch 后 console.error，不阻塞请求）。
 */
export async function writeRouteTrace(
  trace: RouteTrace,
  opts: { dir?: string } = {},
): Promise<string | null> {
  if (!isRouteTraceEnabled()) return null

  const parsed = RouteTraceSchema.safeParse(trace)
  if (!parsed.success) {
    throw new Error(`route trace 不符合 schema：${parsed.error.message}`)
  }

  const dir = opts.dir ?? resolveRouteTraceDir()
  await mkdir(dir, { recursive: true })
  const file = join(dir, `consult-${Date.now()}-${trace.consultLogId ?? 'no-log'}.json`)
  await writeFile(file, JSON.stringify(parsed.data, null, 2), 'utf8')
  return file
}
