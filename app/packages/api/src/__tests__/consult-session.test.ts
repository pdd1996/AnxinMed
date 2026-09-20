/**
 * 会话层集成测试（M4-T5 · specs/04-T5）——consult_sessions + consult_logs 会话列 + 只读端点。
 *
 * 完成标准对照：
 * - 迁移 SQL 进 git（0005_fluffy_shiver_man.sql）；
 * - 集成：userId 隔离（跨用户不串会话 → 404）、首答回传 sessionId、consult_logs.intent 断言；
 * - 不带可选字段 = 行为与 M3 一致（响应仅增 sessionId，路由/回答形态不变）。
 *
 * 本文件用数据类问题（S2，0 LLM）即可驱动全链路，无需药品 fixture。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { consultLogs, consultSessions } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients } from '../lib/ai/types.js'
import { mockClients } from './helpers/ai-mocks.js'

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
const OTHER_USER = 'p-002'

let prevClients: AiClients | null = null

async function cleanup() {
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, OTHER_USER))
  await db.delete(consultSessions).where(eq(consultSessions.userId, USER))
  await db.delete(consultSessions).where(eq(consultSessions.userId, OTHER_USER))
}

beforeAll(async () => {
  await cleanup()
  prevClients = setAiClients(mockClients({})) // S2 数据直答不触达 LLM；mock 仅兜底
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await cleanup()
})

beforeEach(async () => {
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(consultSessions).where(eq(consultSessions.userId, USER))
})

// ---------------------------------------------------------------------------
// 首问建会话 + 首答回传
// ---------------------------------------------------------------------------

describe('POST /api/consult · 会话创建（无 sessionId）', () => {
  it('首问 → 响应带 sessionId；consult_sessions 建行（title=首问截断）；consult_logs 落 session_id/turn_no=1', async () => {
    const res = await req('POST', '/api/consult', { question: '我现在有多少药物', drugIds: [] })

    expect(res.status).toBe(200)
    expect(typeof res.body.sessionId).toBe('string')
    expect(res.body.sessionId).not.toBe('')
    // M3 行为不变：其余字段照常
    expect(res.body.status).toBe('data-answered')
    expect(res.body.toolUsed).toBe('medication-list')

    const sessions = await db.select().from(consultSessions).where(eq(consultSessions.userId, USER))
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(res.body.sessionId)
    expect(sessions[0].title).toBe('我现在有多少药物')

    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs).toHaveLength(1)
    expect(logs[0].sessionId).toBe(res.body.sessionId)
    expect(logs[0].turnNo).toBe(1)
    // intent 留痕：S2 命中 → 意图名
    expect(logs[0].intent).toBe('medication-list')
  })

  it('title 取首问前 30 字符（截断）', async () => {
    const longQuestion = '这个问题的长度明显超过三十个字符用来验证会话标题截断行为是否正确执行到底了没有呀'
    const res = await req('POST', '/api/consult', { question: longQuestion, drugIds: [] })
    expect(res.status).toBe(200)
    const sessions = await db.select().from(consultSessions).where(eq(consultSessions.userId, USER))
    expect(sessions[0].title).toHaveLength(30)
    expect(sessions[0].title).toBe(longQuestion.slice(0, 30))
  })
})

// ---------------------------------------------------------------------------
// 续问（带 sessionId）
// ---------------------------------------------------------------------------

describe('POST /api/consult · 会话续问（带 sessionId）', () => {
  it('第二问带 sessionId → 同会话 turn_no=2，last_active_at 刷新；intent 按 S1 兜底为 null', async () => {
    const first = await req('POST', '/api/consult', { question: '我现在有多少药物', drugIds: [] })
    const sessionId = first.body.sessionId
    const before = await db.select().from(consultSessions).where(eq(consultSessions.id, sessionId))

    // 说明书类问题（S1 兜底）：无药上下文 → no-source，但 intent 应为 null（非 S2 意图）
    const second = await req('POST', '/api/consult', {
      question: '这个药通常用于什么？',
      drugIds: [],
      sessionId,
    })

    expect(second.status).toBe(200)
    expect(second.body.sessionId).toBe(sessionId) // 续问回传同一会话
    expect(second.body.status).toBe('no-source')

    const logs = await db
      .select()
      .from(consultLogs)
      .where(eq(consultLogs.userId, USER))
      .orderBy(consultLogs.turnNo)
    expect(logs).toHaveLength(2)
    expect(logs[0].turnNo).toBe(1)
    expect(logs[1].turnNo).toBe(2)
    expect(logs[1].sessionId).toBe(sessionId)
    expect(logs[1].intent).toBeNull() // 说明书管线兜底 → intent 可空口径

    const after = await db.select().from(consultSessions).where(eq(consultSessions.id, sessionId))
    expect(new Date(after[0].lastActiveAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before[0].lastActiveAt).getTime(),
    )
    // title 定格为首问（续问不改标题）
    expect(after[0].title).toBe('我现在有多少药物')
  })

  it('skillId 透传落 consult_logs.intent（本任务不改路由：S1 问题仍走说明书管线）', async () => {
    const res = await req('POST', '/api/consult', {
      question: '帮我看看这个药的情况', // 正则不命中任何意图（S1 兜底路径）
      drugIds: [],
      skillId: 's1-insert',
    })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('no-source') // 未被快路径改道（T5 仅透传留痕）

    const logs = await db.select().from(consultLogs).where(eq(consultLogs.userId, USER))
    expect(logs[0].intent).toBe('s1-insert') // skillId 原样落列
  })

  it('无效 sessionId（不存在）→ 404 可见失败，不静默改道', async () => {
    const res = await req('POST', '/api/consult', {
      question: '我现在有多少药物',
      drugIds: [],
      sessionId: 'csess-not-exist',
    })
    expect(res.status).toBe(404)
    expect(res.body.ok).toBe(false)
    expect(res.body.code).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// userId 隔离（跨用户不串会话）
// ---------------------------------------------------------------------------

describe('会话 userId 隔离', () => {
  it('POST 续问他人会话 → 404（不泄漏资源存在性之外的信息，直接拒绝）', async () => {
    // 他人（p-002）的会话
    await db.insert(consultSessions).values({
      id: 'csess-other-user',
      userId: OTHER_USER,
      title: '别人的会话',
    })
    const res = await req('POST', '/api/consult', {
      question: '我现在有多少药物',
      drugIds: [],
      sessionId: 'csess-other-user',
    })
    expect(res.status).toBe(404)
  })

  it('GET /api/consult/sessions/:id 他人会话 → 404；本人会话 → 按 turnNo 回放', async () => {
    await db.insert(consultSessions).values({ id: 'csess-other-2', userId: OTHER_USER, title: '别人的' })

    // 本人建两轮会话
    const first = await req('POST', '/api/consult', { question: '我现在有多少药物', drugIds: [] })
    await req('POST', '/api/consult', { question: '我的依从性怎么样', drugIds: [], sessionId: first.body.sessionId })

    const other = await req('GET', '/api/consult/sessions/csess-other-2')
    expect(other.status).toBe(404)

    const detail = await req('GET', `/api/consult/sessions/${first.body.sessionId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.session.id).toBe(first.body.sessionId)
    expect(detail.body.session.title).toBe('我现在有多少药物')
    expect(detail.body.messages).toHaveLength(2)
    expect(detail.body.messages[0].turnNo).toBe(1)
    expect(detail.body.messages[0].question).toBe('我现在有多少药物')
    expect(detail.body.messages[0].status).toBe('data-answered')
    expect(detail.body.messages[1].turnNo).toBe(2)
  })

  it('GET /api/consult/sessions 列表仅含本人会话，按 last_active_at 倒序', async () => {
    await db.insert(consultSessions).values({ id: 'csess-other-3', userId: OTHER_USER, title: '别人的' })
    const s1 = await req('POST', '/api/consult', { question: '第一会话首问', drugIds: [] })
    const s2 = await req('POST', '/api/consult', { question: '第二会话首问', drugIds: [] })

    const list = await req('GET', '/api/consult/sessions')
    expect(list.status).toBe(200)
    const ids: string[] = list.body.items.map((i: any) => i.id)
    expect(ids).not.toContain('csess-other-3')
    expect(ids).toContain(s1.body.sessionId)
    expect(ids).toContain(s2.body.sessionId)
    // 最新活跃的排前面（s2 后创建）
    expect(ids.indexOf(s2.body.sessionId)).toBeLessThan(ids.indexOf(s1.body.sessionId))
  })
})
