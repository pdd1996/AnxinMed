/**
 * T7 语义归一化 · API 集成测试（M13-P2 · specs/20）。
 *
 * 目标：证明归一化在真实 HTTP 链路上生效（不是只有纯函数测试）：
 * - 口语「药快吃没了」「我现在都吃哪些药」→ S2 数据直答（0 次 LLM）；
 * - `ENABLE_ROUTE_NORMALIZE=false` 时同句回退 S1（no-source），行为可一键回滚；
 * - 送模型原文不变由纯函数测试与 fixture 未重录保证，本文件不重复断言。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { consultLogs } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients } from '../lib/ai/types.js'
import { mockClients, newCalls } from './helpers/ai-mocks.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

const USER = 'p-001'
let prevClients: AiClients | null = null
const prevNormalize = process.env.ENABLE_ROUTE_NORMALIZE

beforeAll(() => {
  prevClients = setAiClients(mockClients({}))
})

afterEach(() => {
  if (prevNormalize === undefined) delete process.env.ENABLE_ROUTE_NORMALIZE
  else process.env.ENABLE_ROUTE_NORMALIZE = prevNormalize
  prevClients = setAiClients(mockClients({}))
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await db
    .delete(consultLogs)
    .where(
      and(
        eq(consultLogs.userId, USER),
        inArray(consultLogs.question, ['药快吃没了', '我现在都吃哪些药']),
      ),
    )
})

describe('T7 归一化 · 真实 API 链路', () => {
  it('口语「药快吃没了」→ data-answered + expiry-stock，0 次 LLM', async () => {
    const calls = newCalls()
    setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '药快吃没了',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('data-answered')
    expect(res.body.toolUsed).toBe('expiry-stock')
    expect(calls.consultAnswer).toBe(0)

    const [log] = await db
      .select()
      .from(consultLogs)
      .where(and(eq(consultLogs.userId, USER), eq(consultLogs.question, '药快吃没了')))
      .orderBy(desc(consultLogs.createdAt))
      .limit(1)
    expect(log?.status).toBe('data-answered')
    expect(log?.intent).toBe('expiry-stock')
  })

  it('清单口语「我现在都吃哪些药」→ data-answered + medication-list，0 次 LLM', async () => {
    const calls = newCalls()
    setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '我现在都吃哪些药',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('data-answered')
    expect(res.body.toolUsed).toBe('medication-list')
    expect(calls.consultAnswer).toBe(0)
  })

  it('归一化关闭：同一句「药快吃没了」回退 S1 → no-source（可回滚）', async () => {
    process.env.ENABLE_ROUTE_NORMALIZE = 'false'
    const calls = newCalls()
    setAiClients(mockClients({ calls }))

    const res = await req('POST', '/api/consult', {
      question: '药快吃没了',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('no-source')
    expect(calls.consultAnswer).toBe(0)
  })
})
