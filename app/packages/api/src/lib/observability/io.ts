/**
 * G10 可观测性 · 文件 IO 公共助手：LOG_DIR 解析 / 按日文件名 / 原子写。
 *
 * 目录口径（部署与本地一致）：
 * - 默认 `./logs`（相对进程 cwd；从 `app/packages/api` 启动 → `app/packages/api/logs`）；
 * - 生产由 docker-compose 注入 `LOG_DIR=/app/logs`，并把宿主机 `app/logs` 挂载进去（deploy/README.md §9.4）。
 *
 * 每次调用都重新读 env（不缓存模块常量）：测试可切临时目录，运维改 env 后无需改代码。
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** 日志/指标落盘目录（未配置/空串 → './logs'）。 */
export function logDir(): string {
  const raw = (process.env.LOG_DIR ?? '').trim()
  return raw.length > 0 ? raw : './logs'
}

/** 本地时区日历日 YYYY-MM-DD（与 shared/todayStr 同口径，用于「当日」指标与预算）。 */
export function dateKey(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 确保落盘目录存在并返回其路径。 */
export function ensureLogDir(): string {
  const dir = logDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 落盘文件路径（fileName 由调用方给，如 api-errors-2026-11-18.jsonl）。 */
export function logFilePath(fileName: string): string {
  return join(logDir(), fileName)
}

/**
 * 原子写 JSON：先写同目录临时文件再 rename（同分区 rename 原子，进程中途退出不会留下半截 JSON）。
 * 写失败抛错，由调用方转成可见日志（不静默吞错）。
 */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.${basename(filePath)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`)
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, 'utf8')
  renameSync(tmp, filePath)
}

/** 截断超长文本（保留头部），防单条日志/错误栈异常膨胀。 */
export function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…[truncated]`
}
