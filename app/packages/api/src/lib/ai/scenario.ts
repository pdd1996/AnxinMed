/**
 * E2E 场景上下文（M2-T10）—— 把请求级 `x-test-scenario` 头透传到 AI 客户端层。
 *
 * AiClients 是单例（registry），方法签名不含 Hono context；而 E2E 多 worker 并发打同一 api 进程，
 * 场景必须**按请求**隔离 → 用 AsyncLocalStorage 在请求 async 链内传播（middleware run → 管线 → 客户端）。
 * 非 fixtures 模式不读不写，零开销。
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage<string>()

/** middleware 内包裹 next()，使本请求 async 链内 currentScenario() 可读。 */
export function withScenario<T>(scenario: string, fn: () => Promise<T>): Promise<T> {
  return als.run(scenario, fn)
}

/** 当前请求的场景名（无头/非 fixtures 模式为空串）。 */
export function currentScenario(): string {
  return als.getStore() ?? ''
}
