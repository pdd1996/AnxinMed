import { hc } from 'hono/client'
import { toast } from 'sonner'
import type { AppType } from '@anxin/api'

/**
 * hc<AppType> 端到端类型客户端（技术方案 §1）。
 * AppType 为 type-only 导入，构建期擦除，不把 api 运行时代码（serve/db）带进 web（执行总纲 §3.1）。
 * baseUrl '/'：dev 经 vite 代理 /api→8787，prod 由 Hono 同源托管，均用相对路径。
 */
export const client = hc<AppType>('/')

/**
 * 统一拆包 + 错误 toast：res.ok 或 body.ok 为假时，解析 { ok:false, code, message } → toast 报错并抛错。
 * 成功返回精确响应体（hc<AppType> 推导）。禁止静默吞错（执行总纲 §0.5）。
 */
export async function unwrap<T extends { ok: boolean }>(
  res: { ok: boolean; json(): Promise<T> },
): Promise<T> {
  const body = await res.json()
  if (!res.ok || !body.ok) {
    const err = body as unknown as { message?: string; code?: string }
    const message = typeof err.message === 'string' ? err.message : '请求失败，请稍后重试'
    toast.error(message)
    throw new Error(message)
  }
  return body
}

/** 药箱列表：编译期验证 hc<AppType> 端到端推导（client.api.drugs.$get → data.items 精确类型）。T9 用 TanStack Query 调用。 */
export async function fetchDrugs() {
  const res = await client.api.drugs.$get()
  const data = await unwrap(res)
  return data.items
}

/** 今日任务：验证嵌套路径 /api/tasks/today 的类型连通。 */
export async function fetchTodayTasks() {
  const res = await client.api.tasks.today.$get()
  return unwrap(res)
}
