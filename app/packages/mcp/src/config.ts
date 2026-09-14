/**
 * MCP Server 配置（ADR #19）——环境变量加载，fail-fast 不静默。
 *
 * - ANXIN_API_BASE_URL：安心用药 API 地址（默认 http://127.0.0.1:8787）；
 * - ANXIN_API_TOKEN：可选 Bearer Token（API 层接入鉴权后透传，MVP 演示用户可省略）；
 * - ANXIN_API_TIMEOUT_MS：上游请求超时（默认 10000）。
 */
export interface McpConfig {
  baseUrl: string
  token?: string
  timeoutMs: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const baseUrl = (env.ANXIN_API_BASE_URL ?? 'http://127.0.0.1:8787').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error(`ANXIN_API_BASE_URL 非法：${baseUrl}（须以 http(s):// 开头）`)
  }
  const token = env.ANXIN_API_TOKEN?.trim() || undefined
  const timeoutMs = env.ANXIN_API_TIMEOUT_MS ? Number(env.ANXIN_API_TIMEOUT_MS) : 10_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`ANXIN_API_TIMEOUT_MS 非法：${env.ANXIN_API_TIMEOUT_MS}（须为正整数毫秒）`)
  }
  return { baseUrl, token, timeoutMs }
}
