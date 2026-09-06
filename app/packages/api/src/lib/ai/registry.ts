/**
 * AI 客户端注入接缝（M2-T6 / T10）—— 管线 run.ts / intake.service 经此取得 AiClients，不直接 import 具体实现。
 *
 * 生产：默认 createAiClients()（真实 qwen/ocr/baichuan；其内部惰性读 env，模块加载不抛错，已核实）。
 * 测试：setAiClients(mock) 注入 mock，配合 app.request() 跑全真编排代码（无 key 也能测）。
 * E2E（T10）：进程以 AI_MODE=fixtures 启动时惰性装配 FixtureAiClients，按请求 x-test-scenario 头回放录制包。
 *
 * 这是「管线依赖注入的唯一接缝」：编排、降级、事务、API 走全真代码，只冻结模型 I/O。
 * 默认客户端**惰性**创建（首调 getAiClients 时按 AI_MODE 决定），避免模块加载即读 env/建实例。
 */
import { createAiClients } from './index.js'
import { FixtureAiClients } from './fixtures.js'
import type { AiClients } from './types.js'

let current: AiClients | null = null

/** 按 AI_MODE 选默认实现：fixtures → 回放；其余（含 record 由录制脚本自行 setAiClients）→ 真实。 */
function defaultClients(): AiClients {
  if (process.env.AI_MODE === 'fixtures') return new FixtureAiClients()
  return createAiClients()
}

/** 取当前 AI 客户端（路由 handler 调用后传入 service / 管线）。 */
export function getAiClients(): AiClients {
  if (!current) current = defaultClients()
  return current
}

/** 替换 AI 客户端（测试 / E2E fixture 注入接缝）。返回前一个，便于测试还原。 */
export function setAiClients(clients: AiClients): AiClients {
  const prev = current ?? defaultClients()
  current = clients
  return prev
}
