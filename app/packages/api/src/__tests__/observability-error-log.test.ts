/**
 * G10 单测：错误日志落盘（JSONL 字段 / 10MB 轮转 / 14 天清理 / PII 脱敏 / app.onError 接入）。
 *
 * 全部写入临时 LOG_DIR；不真调模型、不依赖真实用户数据。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../app.js'
import {
  getTodayErrorCount,
  logApiError,
  logProcessError,
  resetErrorLogForTests,
} from '../lib/observability/error-log.js'
import { dateKey } from '../lib/observability/io.js'

const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE
const ORIGINAL_LOG_DIR = process.env.LOG_DIR

let dir = ''
const FIXED_NOW = new Date(2026, 10, 18, 10, 0, 0)

function errorFile(day = dateKey(FIXED_NOW)): string {
  return join(dir, `api-errors-${day}.jsonl`)
}

function readLines(file = errorFile()): Record<string, unknown>[] {
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function sampleRecord() {
  return {
    event: 'request_error' as const,
    code: 'INTERNAL',
    status: 500,
    method: 'POST',
    path: '/api/consult',
    requestId: 'rid-1',
    errorName: 'TypeError',
    message: '数据库连接失败',
    stack: 'TypeError: 数据库连接失败\n    at handler (/app/src/x.ts:1:1)',
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anxin-obs-error-log-'))
  process.env.LOG_DIR = dir
  resetErrorLogForTests()
})

afterEach(() => {
  resetErrorLogForTests()
  if (ORIGINAL_LOG_DIR === undefined) delete process.env.LOG_DIR
  else process.env.LOG_DIR = ORIGINAL_LOG_DIR
  if (ORIGINAL_AUTH_MODE === undefined) delete process.env.AUTH_MODE
  else process.env.AUTH_MODE = ORIGINAL_AUTH_MODE
  rmSync(dir, { recursive: true, force: true })
})

describe('JSONL 落盘与字段', () => {
  it('按 JSONL 写入当日文件，字段完整且无请求体/用户内容字段', () => {
    logApiError(sampleRecord(), { now: FIXED_NOW })

    expect(existsSync(errorFile())).toBe(true)
    const entries = readLines()
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry).toMatchObject({
      level: 'error',
      event: 'request_error',
      code: 'INTERNAL',
      status: 500,
      method: 'POST',
      path: '/api/consult',
      requestId: 'rid-1',
      errorName: 'TypeError',
      message: '数据库连接失败',
    })
    expect(typeof entry.ts).toBe('string')
    expect(String(entry.ts)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(String(entry.stack)).toContain('at handler')
    // 结构上绝不包含请求体/用户问题/模型输出字段
    for (const forbidden of ['body', 'question', 'answer', 'content', 'requestBody', 'response', 'payload']) {
      expect(entry).not.toHaveProperty(forbidden)
    }
  })

  it('message/stack 过 L3 脱敏模式（手机号/标签姓名 → [已脱敏]），且长度截断', () => {
    logApiError(
      {
        ...sampleRecord(),
        message: `请求处理失败：联系电话13812345678，姓名：张三`,
        stack: `Error: phone=13812345678\n${'x'.repeat(10_000)}`,
      },
      { now: FIXED_NOW },
    )

    const raw = readFileSync(errorFile(), 'utf8')
    expect(raw).not.toContain('13812345678')
    expect(raw).not.toContain('张三')
    expect(raw).toContain('[已脱敏]')
    const entry = readLines()[0]!
    expect(String(entry.message).length).toBeLessThan(1200)
    expect(String(entry.stack).length).toBeLessThan(4200)
  })

  it('可选字段缺失写 null（method/path/requestId/stack 稳定形状）', () => {
    logApiError({ event: 'request_error', code: 'INTERNAL', status: 500, errorName: 'Error', message: 'boom' }, { now: FIXED_NOW })
    const entry = readLines()[0]!
    expect(entry.method).toBeNull()
    expect(entry.path).toBeNull()
    expect(entry.requestId).toBeNull()
    expect(entry.stack).toBeNull()
  })
})

describe('单文件 10MB 轮转与 14 天清理', () => {
  it('写入将超过单文件上限时轮转为 .1，新文件只含后续行', () => {
    const options = { now: FIXED_NOW, maxBytes: 400 }
    logApiError({ ...sampleRecord(), message: `第一行-${'A'.repeat(200)}` }, options)
    logApiError({ ...sampleRecord(), message: `第二行-${'B'.repeat(200)}` }, options)

    expect(existsSync(`${errorFile()}.1`)).toBe(true)
    const rotated = readFileSync(`${errorFile()}.1`, 'utf8')
    const current = readFileSync(errorFile(), 'utf8')
    expect(rotated).toContain('第一行')
    expect(current).not.toContain('第一行')
    expect(current).toContain('第二行')
  })

  it('首次写入清理超过 14 天的错误日志（含 .1），保留 14 天内文件', () => {
    const today = dateKey(FIXED_NOW) // 2026-11-18
    const expired = '2026-11-03' // 15 天前
    const kept = '2026-11-05' // 13 天前
    writeFileSync(join(dir, `api-errors-${expired}.jsonl`), '{}\n')
    writeFileSync(join(dir, `api-errors-${expired}.jsonl.1`), '{}\n')
    writeFileSync(join(dir, `api-errors-${kept}.jsonl`), '{}\n')

    logApiError(sampleRecord(), { now: FIXED_NOW })

    expect(existsSync(join(dir, `api-errors-${expired}.jsonl`))).toBe(false)
    expect(existsSync(join(dir, `api-errors-${expired}.jsonl.1`))).toBe(false)
    expect(existsSync(join(dir, `api-errors-${kept}.jsonl`))).toBe(true)
    expect(existsSync(errorFile(today))).toBe(true)
  })
})

describe('app.onError 接入与 requestId', () => {
  it('未处理/ApiError 5xx 落盘（AUTH_MODE 非法 → 500 INTERNAL），requestId 贯穿响应头与日志', async () => {
    process.env.AUTH_MODE = 'not-a-valid-mode'
    const res = await app.request('/api/drugs')
    expect(res.status).toBe(500)
    const requestId = res.headers.get('x-request-id')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)

    const file = join(dir, `api-errors-${dateKey()}.jsonl`)
    expect(existsSync(file)).toBe(true)
    const entries = readLines(file)
    const hit = entries.find((entry) => entry.requestId === requestId)
    expect(hit).toMatchObject({
      event: 'request_error',
      code: 'INTERNAL',
      status: 500,
      method: 'GET',
      path: '/api/drugs',
    })
    expect(String(hit?.message)).toContain('AUTH_MODE')
  })

  it('4xx 业务错误不落错误日志（避免淹没真正错误面），但响应仍可见', async () => {
    process.env.AUTH_MODE = 'demo'
    const before = getTodayErrorCount()
    const res = await app.request('/api/drugs/does-not-exist')
    expect(res.status).toBe(404)
    expect(getTodayErrorCount()).toBe(before)
  })
})

describe('进程级错误记录', () => {
  it('uncaughtException / unhandledRejection 落盘 event 区分，非 Error reason 也能记录', () => {
    logProcessError('uncaught_exception', new Error('fatal boom'))
    logProcessError('unhandled_rejection', 'promise rejected with string')
    expect(getTodayErrorCount()).toBe(2)
    const entries = readLines(errorFile(dateKey()))
    expect(entries.map((entry) => entry.event)).toEqual(['uncaught_exception', 'unhandled_rejection'])
    expect(entries[0]!.errorName).toBe('Error')
    expect(entries[1]!.errorName).toBe('NonError')
    expect(String(entries[1]!.message)).toContain('string')
  })
})
