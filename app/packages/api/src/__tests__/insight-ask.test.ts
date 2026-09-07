/**
 * T7 医生端问答测试：队列意图路由 golden（宁漏勿误 + 解释类仲裁）+ POST /api/insight/ask
 * 全链（data 路径 0 次 LLM 红线 / 长尾 LLM 路径 / 患者维度 / 404 / 校验 / PII 脱敏 / 留痕）。
 *
 * 完成标准（spec §T7）：固定问法 0 次 LLM 调用直查库；漏判留痕（intent=null）作为扩工具依据。
 * 测试库自建 fixture（qb-1/qb-2），afterAll 清理；断言锚定自建 id，不锚定全局总数。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { insightAskLogs, records, users } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import { mockClients, newCalls, type AiCalls } from './helpers/ai-mocks.js'
import { classifyQueueIntent } from '../services/insight/askIntent.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

const PATIENT = 'qb-1'
const PATIENT_EMPTY = 'qb-2'

let prevClients: ReturnType<typeof setAiClients> | null = null

beforeAll(async () => {
  await db.insert(users).values([
    { id: PATIENT, name: '问答测试患者' },
    { id: PATIENT_EMPTY, name: '无数据患者' },
  ])
  // PATIENT：10 条全 taken → 执行率 100%（患者维度依从性查询有数据）
  const recRows = Array.from({ length: 10 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (9 - i))
    return {
      id: `qb-rec-${i}`,
      userId: PATIENT,
      planId: 'qb-plan-1',
      scheduledDate: d.toISOString().slice(0, 10),
      scheduledTime: '08:00',
      status: 'taken' as const,
    }
  })
  await db.insert(records).values(recRows)
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await db.delete(insightAskLogs).where(inArray(insightAskLogs.patientId, [PATIENT, PATIENT_EMPTY]))
  await db.delete(insightAskLogs).where(eq(insightAskLogs.mode, 'data')) // 队列维度问法行（patientId=null）
  await db.delete(records).where(inArray(records.userId, [PATIENT, PATIENT_EMPTY]))
  await db.delete(users).where(inArray(users.id, [PATIENT, PATIENT_EMPTY]))
})

/** 最近一条 ask 留痕（按 createdAt 倒序）。 */
async function lastAskLog(): Promise<any> {
  const rows = await db.select().from(insightAskLogs).limit(20)
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return rows[0]
}

// ---------------------------------------------------------------------------
// 队列意图路由 golden（spec §T7：分布/差档队列/事件聚合各 2，新增词必须先补口语变体）
// ---------------------------------------------------------------------------

describe('classifyQueueIntent · golden 固定问法（正则白名单）', () => {
  it('分布 ×2', () => {
    expect(classifyQueueIntent('依从性分布怎么样？')).toBe('adherence-distribution')
    expect(classifyQueueIntent('执行率统计一下')).toBe('adherence-distribution')
    expect(classifyQueueIntent('优中差各多少人')).toBe('adherence-distribution')
  })

  it('差档队列 ×2', () => {
    expect(classifyQueueIntent('执行率差的患者有哪些？')).toBe('poor-cohort')
    expect(classifyQueueIntent('给我一份随访名单')).toBe('poor-cohort')
    expect(classifyQueueIntent('哪些患者需要随访')).toBe('poor-cohort')
  })

  it('事件聚合 ×2', () => {
    expect(classifyQueueIntent('最近的风险事件汇总')).toBe('risk-events')
    expect(classifyQueueIntent('有没有被拦截过的情况')).toBe('risk-events')
    expect(classifyQueueIntent('有没有紧急信号')).toBe('risk-events')
  })

  it('解释类词仲裁：宁漏勿误（走 LLM 叙述而非统计模板）', () => {
    expect(classifyQueueIntent('这批患者的副作用发生率如何')).toBeNull()
    expect(classifyQueueIntent('依从性差的患者有什么禁忌需要注意')).toBeNull()
  })

  it('未命中 → null（长尾，走 LLM 路径）', () => {
    expect(classifyQueueIntent('给本单位一个整体评价')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// POST /api/insight/ask · data 路径（0 次 LLM 红线）
// ---------------------------------------------------------------------------

describe('POST /api/insight/ask · 队列维度固定问法（0 次 LLM）', () => {
  let calls: AiCalls

  beforeAll(() => {
    calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))
  })

  it('分布问法 → mode=data + adherence_distribution + 0 次 LLM + 留痕', async () => {
    const res = await req('POST', '/api/insight/ask', { question: '依从性分布怎么样？' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.mode).toBe('data')
    expect(res.body.toolUsed).toBe('adherence_distribution')
    expect(res.body.riskLevel).toBe('L1')
    expect(res.body.sections.summary).toContain('队列共')
    expect(res.body.suggestions.length).toBeGreaterThan(0)

    // 0 次 LLM 红线（PRD 红线，同 consult-dataquery 口径）
    expect(calls.queueSummary).toBe(0)
    expect(calls.consultAnswer).toBe(0)
    expect(calls.insightSummary).toBe(0)

    // 留痕：intent 非空
    const log = await lastAskLog()
    expect(log.intent).toBe('adherence-distribution')
    expect(log.mode).toBe('data')
    expect(log.patientId).toBeNull()
  })

  it('差档名单问法 → patient_cohort + 名单模板', async () => {
    const res = await req('POST', '/api/insight/ask', { question: '执行率差的患者有哪些？' })
    expect(res.status).toBe(200)
    expect(res.body.mode).toBe('data')
    expect(res.body.toolUsed).toBe('patient_cohort')
    expect(res.body.citations.join()).toContain('本地队列数据')
    expect(calls.queueSummary).toBe(0)
  })

  it('事件聚合问法 → risk_event_rollup', async () => {
    const res = await req('POST', '/api/insight/ask', { question: '最近的风险事件汇总' })
    expect(res.status).toBe(200)
    expect(res.body.mode).toBe('data')
    expect(res.body.toolUsed).toBe('risk_event_rollup')
    expect(calls.queueSummary).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// POST /api/insight/ask · 患者维度（复用 consult 意图路由）
// ---------------------------------------------------------------------------

describe('POST /api/insight/ask · 患者维度', () => {
  it('依从性问法 → data 路径复用 runDataQuery（0 次 LLM）+ 留痕 patientId', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))
    const res = await req('POST', '/api/insight/ask', { question: '他最近依从性怎么样？', patientId: PATIENT })
    expect(res.status).toBe(200)
    expect(res.body.mode).toBe('data')
    expect(res.body.toolUsed).toBe('adherence')
    expect(res.body.sections.summary).toContain('执行率')
    expect(calls.consultAnswer).toBe(0)

    const log = await lastAskLog()
    expect(log.patientId).toBe(PATIENT)
    expect(log.intent).toBe('adherence')
  })

  it('解释类问法（副作用）→ 长尾 LLM 路径（mock）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(
      mockClients({
        calls,
        insight: {
          summary: '该患者未见明显不良反应记录',
          keyPoints: [],
          risks: [],
          nextAction: '诊间确认',
          warning: '仅供参考',
        },
      }),
    )
    const origKey = process.env.BAICHUAN_API_KEY
    process.env.BAICHUAN_API_KEY = 'test-key'
    try {
      const res = await req('POST', '/api/insight/ask', { question: '他的药有什么副作用', patientId: PATIENT })
      expect(res.status).toBe(200)
      expect(res.body.mode).toBe('llm')
      expect(calls.insightSummary).toBe(1)

      const log = await lastAskLog()
      expect(log.mode).toBe('llm')
      expect(log.intent).toBeNull() // 漏判留痕
    } finally {
      if (origKey === undefined) delete process.env.BAICHUAN_API_KEY
      else process.env.BAICHUAN_API_KEY = origKey
    }
  })

  it('队列维度长尾 → LLM 路径（mock queueSummary）', async () => {
    const calls = newCalls()
    prevClients = setAiClients(
      mockClients({
        calls,
        queue: { summary: '队列整体平稳', keyPoints: [], risks: [], nextAction: '常规随访', warning: '仅供参考' },
      }),
    )
    const origKey = process.env.BAICHUAN_API_KEY
    process.env.BAICHUAN_API_KEY = 'test-key'
    try {
      const res = await req('POST', '/api/insight/ask', { question: '给本单位一个整体评价' })
      expect(res.status).toBe(200)
      expect(res.body.mode).toBe('llm')
      expect(calls.queueSummary).toBe(1)
    } finally {
      if (origKey === undefined) delete process.env.BAICHUAN_API_KEY
      else process.env.BAICHUAN_API_KEY = origKey
    }
  })
})

// ---------------------------------------------------------------------------
// 校验 / 404 / 脱敏
// ---------------------------------------------------------------------------

describe('POST /api/insight/ask · 校验与 L3 出口脱敏', () => {
  beforeAll(() => {
    prevClients = setAiClients(mockClients({}))
  })

  it('空问题 → 400 VALIDATION', async () => {
    const res = await req('POST', '/api/insight/ask', { question: '' })
    expect(res.status).toBe(400)
  })

  it('patientId 不存在 → 404 NOT_FOUND', async () => {
    const res = await req('POST', '/api/insight/ask', { question: '依从性怎么样', patientId: 'nope' })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  it('提问含手机号 → 留痕为脱敏后文本（L3 出口约束）', async () => {
    const res = await req('POST', '/api/insight/ask', { question: '依从性分布怎么样？我电话13812345678' })
    expect(res.status).toBe(200)
    const log = await lastAskLog()
    expect(log.question).not.toContain('13812345678')
  })
})
