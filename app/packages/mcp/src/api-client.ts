/**
 * 安心用药 API 转发客户端（ADR #19）——MCP Server 不碰数据库，只调既有守门端点。
 *
 * 安全模型（对齐 ADR #17 / 文章主张）：
 * - 参数校验、意图路由、禁 SQL 边界全部在 API 层；本层只做转发，无任何 SQL 面；
 * - 错误信息面向模型/用户可读：透传 API 的 { code, message }（本就是用户可理解文案），
 *   网络层与解析层异常细节只进 stderr 日志，绝不进入工具结果（禁把连接串/堆栈泄给模型）；
 * - stdio 模式下 stdout 是 MCP 协议通道，所有日志走 stderr。
 */

/** 工具结果可呈现的上游错误（message 已面向用户，可直接返回给模型）。 */
export class ApiToolError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(userMessage)
    this.name = 'ApiToolError'
  }
}

export interface ApiClientOptions {
  baseUrl: string
  token?: string
  timeoutMs: number
  /** 测试注入口，默认全局 fetch。 */
  fetchImpl?: typeof fetch
}

/** API 统一响应包络（lib/http.ts 约定）：成功 { ok:true, ...data }，失败 { ok:false, code, message }。 */
export type ApiEnvelope = Record<string, unknown>

export async function callApi(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  opts: ApiClientOptions,
): Promise<ApiEnvelope> {
  const url = `${opts.baseUrl}${path}`
  let res: Response
  try {
    res = await (opts.fetchImpl ?? fetch)(url, {
      method: init.method,
      headers: {
        accept: 'application/json',
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs),
    })
  } catch (err) {
    // 网络层失败（连接拒绝/超时等）：细节只进 stderr，模型侧只拿通用可操作信息。
    console.error('[mcp] api 请求失败', init.method, url, err instanceof Error ? err.message : err)
    throw new ApiToolError(`无法连接安心用药 API（${opts.baseUrl}），请确认 API 服务已启动后重试`)
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // 非 JSON 响应体（如网关 HTML 错误页）：走下面的统一失败分支。
  }

  const envelope = (body ?? {}) as Record<string, unknown>
  if (!res.ok || envelope.ok !== true) {
    const code = typeof envelope.code === 'string' ? envelope.code : 'UNKNOWN'
    const message = typeof envelope.message === 'string' ? envelope.message : ''
    console.error('[mcp] api 响应异常', res.status, code, message)
    // API 层错误文案本就面向用户（「未找到该患者…」等），透传 code + message；
    // 堆栈、连接串等细节不经过本函数的返回路径。
    throw new ApiToolError(
      message ? `安心用药 API 错误（${res.status} ${code}）：${message}` : `安心用药 API 请求失败（HTTP ${res.status}）`,
      res.status,
      code,
    )
  }
  return envelope
}
