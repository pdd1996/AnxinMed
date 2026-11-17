/**
 * G10 可观测性 · 错误日志落盘（JSONL，按日）。
 *
 * 落盘：${LOG_DIR}/api-errors-YYYY-MM-DD.jsonl（LOG_DIR 默认 './logs'）
 * - 单文件 10MB 轮转：超限时把当前文件改名为 `.1`（再写新文件；只保留一份轮转历史）；
 * - 保留 14 天：首次写入与每天首次写入时清理过期文件（含 `.1`）；
 * - JSONL 字段：ts/level/event/code/status/method/path/requestId/errorName/message/stack。
 *
 * 隐私红线（执行总纲 §0.5 / PRD §12.2 L3）：
 * - **绝不记录请求体、用户问题、模型输出、PII**：本模块只接受结构化字段，调用方不得传原文；
 * - message/stack 仍过 L3 出口脱敏模式集（手机号/身份证/地址/病历号/标签姓名），并对长度截断；
 * - path 只记 pathname（不含 query，避免参数里混入用户输入）。
 *
 * 失败语义：落盘失败 → console.error 可见（不静默吞错），但不向业务请求冒泡（错误响应优先）。
 */
import { appendFileSync, existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { PII_ASSERT_PATTERNS, scrubWithPatterns } from '../../services/sanitize/scan.js'
import { dateKey, ensureLogDir, truncate } from './io.js'

/** 单文件轮转阈值：10MB。 */
export const ERROR_LOG_MAX_BYTES = 10 * 1024 * 1024
/** 文件保留天数：14 天（当天 + 前 13 天）。 */
export const ERROR_LOG_RETENTION_DAYS = 14

const MESSAGE_MAX_CHARS = 1000
const STACK_MAX_CHARS = 4000
const FILE_NAME_RE = /^api-errors-(\d{4}-\d{2}-\d{2})\.jsonl(?:\.1)?$/

export type ApiErrorEvent = 'request_error' | 'uncaught_exception' | 'unhandled_rejection'

/** 一条错误日志的结构化入参 —— 刻意不包含 body/question/answer 等任何用户内容字段。 */
export interface ApiErrorLogRecord {
  event: ApiErrorEvent
  code: string
  status: number
  method?: string
  path?: string
  requestId?: string
  errorName: string
  message: string
  stack?: string
}

/** 测试可注入 clock / 轮转阈值 / 保留天数；生产调用不传，全走常量与真实时间。 */
export interface ErrorLogOptions {
  now?: Date
  maxBytes?: number
  retentionDays?: number
}

/** 当日错误计数（summary 用；进程内计数，跨重启不累计——错误明细本身在 JSONL 里）。 */
let countDay = ''
let count = 0
/** 上次清理日（首次写与本日首次写各清理一次）。 */
let lastCleanupDay = ''

/** 清空进程内状态（单测用，避免用例间串扰）。 */
export function resetErrorLogForTests(): void {
  countDay = ''
  count = 0
  lastCleanupDay = ''
}

/** L3 出口脱敏：错误文案/栈里可能被上层拼进用户输入，落盘前一律再扫一遍 PII 模式。 */
function scrub(text: string): string {
  return scrubWithPatterns(text, PII_ASSERT_PATTERNS)
}

function sanitizeErrorName(name: string): string {
  const clean = scrub(String(name ?? '')).replace(/[\r\n]+/g, ' ')
  return truncate(clean, 200)
}

/** 删除超过保留期的错误日志（按文件名日期，含 `.1` 轮转文件）；每天最多执行一次。 */
function cleanupExpired(dir: string, now: Date, retentionDays: number): void {
  const today = dateKey(now)
  if (lastCleanupDay === today) return
  lastCleanupDay = today

  const cutoff = new Date(now.getTime())
  cutoff.setDate(cutoff.getDate() - Math.max(1, retentionDays) + 1)
  const cutoffDay = dateKey(cutoff)

  for (const name of readdirSync(dir)) {
    const match = FILE_NAME_RE.exec(name)
    if (!match) continue
    if (match[1] < cutoffDay) {
      try {
        unlinkSync(join(dir, name))
      } catch (e) {
        console.error(`[obs:error-log] 清理过期日志失败（${name}）：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}

/**
 * 写一条错误日志（JSONL 追加）。
 * 落盘失败只打印可见错误，绝不向业务请求冒泡（错误响应本身不能被日志故障吞掉）。
 */
export function logApiError(record: ApiErrorLogRecord, options: ErrorLogOptions = {}): void {
  try {
    const now = options.now ?? new Date()
    const day = dateKey(now)
    const dir = ensureLogDir()
    cleanupExpired(dir, now, options.retentionDays ?? ERROR_LOG_RETENTION_DAYS)

    const entry = {
      ts: now.toISOString(),
      level: 'error' as const,
      event: record.event,
      code: sanitizeErrorName(record.code),
      status: Number.isFinite(record.status) ? Math.trunc(record.status) : 500,
      method: record.method ?? null,
      path: record.path ?? null,
      requestId: record.requestId ?? null,
      errorName: sanitizeErrorName(record.errorName),
      message: truncate(scrub(String(record.message ?? '')), MESSAGE_MAX_CHARS),
      stack: record.stack ? truncate(scrub(String(record.stack)), STACK_MAX_CHARS) : null,
    }
    const line = `${JSON.stringify(entry)}\n`
    const file = join(dir, `api-errors-${day}.jsonl`)
    const maxBytes = options.maxBytes ?? ERROR_LOG_MAX_BYTES

    // 10MB 轮转：先检查「写完这一行会不会超限」，超限则把当前文件转成 .1 后再写新文件。
    if (existsSync(file) && statSync(file).size + Buffer.byteLength(line, 'utf8') > maxBytes) {
      const rotated = `${file}.1`
      if (existsSync(rotated)) unlinkSync(rotated)
      renameSync(file, rotated)
    }
    appendFileSync(file, line, 'utf8')

    if (countDay !== day) {
      countDay = day
      count = 0
    }
    count += 1
  } catch (e) {
    console.error(`[obs:error-log] 错误日志落盘失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 进程级致命错误（uncaughtException / unhandledRejection）落盘；不改变调用方的退出语义。 */
export function logProcessError(event: 'uncaught_exception' | 'unhandled_rejection', reason: unknown): void {
  const isError = reason instanceof Error
  logApiError({
    event,
    code: 'INTERNAL',
    status: 500,
    errorName: isError ? reason.name : 'NonError',
    message: isError ? reason.message : String(reason),
    stack: isError ? reason.stack : undefined,
  })
}

/** 当日（本地时区）落盘的错误条数（summary errors 字段）。 */
export function getTodayErrorCount(now: Date = new Date()): number {
  return countDay === dateKey(now) ? count : 0
}
