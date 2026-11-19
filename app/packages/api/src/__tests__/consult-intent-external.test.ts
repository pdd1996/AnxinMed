/**
 * 外部知识意图 · DeepSeek 兜底（M14）——纯函数 + API 集成测试。
 *
 * 覆盖：
 * - 候选门控：无物质词 / 超长问题不调模型（普通 S1 零额外调用）；
 * - 输出校验：7 类枚举，非法/缺失 → null；
 * - 规则漏判 + 模型判 external → 进入外部兜底（answered + unverified + 0 次 consultAnswer）；
 * - 模型判 not-external / 抛错 / 开关关闭 → 回落 no-source（不 500、不静默改道）；
 * - ENABLE_EXTERNAL_KNOWLEDGE=false（kill switch）优先于模型判定。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { consultLogs } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients } from '../lib/ai/types.js'
import {
  buildExternalIntentPrompt,
  isExternalIntentCandidate,
  parseIntentVerdict,
  setExternalIntentClassifier,
  shouldAnswerExternalByModel,
} from '../services/consult/intent-external.js'
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
const QUESTIONS = ['酒和头孢能吃吗', '头孢配酒可以吗']

const SAFE_RAW = {
  summary: '酒和头孢类抗菌药不建议同时使用。',
  keyPoints: ['头孢类与酒精同用可能引起双硫仑样反应。'],
  risks: ['可能出现面部潮红、心悸、恶心等不适。'],
  nextAction: '如已同服并出现不适，请及时就医。',
  warning: 'AI 生成，仅供参考，请咨询医生或药师。',
}

const prevClients = { value: null as AiClients | null }
const prevEnv = {
  intentModel: process.env.ENABLE_INTENT_MODEL,
  external: process.env.ENABLE_EXTERNAL_KNOWLEDGE,
}

beforeAll(() => {
  prevClients.value = setAiClients(mockClients({}))
  // vitest 配置默认 ENABLE_INTENT_MODEL=false（防其它测试打真实模型）；本文件显式开启。
  process.env.ENABLE_INTENT_MODEL = 'true'
})

afterEach(() => {
  setExternalIntentClassifier(null)
  process.env.ENABLE_INTENT_MODEL = 'true'
  if (prevEnv.external === undefined) delete process.env.ENABLE_EXTERNAL_KNOWLEDGE
  else process.env.ENABLE_EXTERNAL_KNOWLEDGE = prevEnv.external
  if (prevClients.value) setAiClients(mockClients({}))
})

afterAll(async () => {
  if (prevClients.value) setAiClients(prevClients.value)
  if (prevEnv.intentModel === undefined) delete process.env.ENABLE_INTENT_MODEL
  else process.env.ENABLE_INTENT_MODEL = prevEnv.intentModel
  await db
    .delete(consultLogs)
    .where(and(eq(consultLogs.userId, USER), inArray(consultLogs.question, QUESTIONS)))
})

describe('intent-external · 纯函数', () => {
  it('输出枚举：external → external，其他合法意图 → not-external', () => {
    expect(parseIntentVerdict({ intent: 'external-substance-interaction' })).toBe('external')
    expect(parseIntentVerdict({ intent: 'S1' })).toBe('not-external')
    expect(parseIntentVerdict({ intent: 'expiry-stock' })).toBe('not-external')
  })

  it('非法/缺失输出 → null（由调用方回落规则）', () => {
    expect(parseIntentVerdict({ intent: 'not-a-class' })).toBeNull()
    expect(parseIntentVerdict({})).toBeNull()
    expect(parseIntentVerdict(null)).toBeNull()
    expect(parseIntentVerdict('external-substance-interaction')).toBeNull()
  })

  it('候选门控：有物质词才调模型，普通问题/超长问题不调', () => {
    expect(isExternalIntentCandidate('酒和头孢能吃吗')).toBe(true)
    expect(isExternalIntentCandidate('西柚和他汀能吃吗')).toBe(true)
    expect(isExternalIntentCandidate('阿司匹林有什么副作用')).toBe(false)
    expect(isExternalIntentCandidate('')).toBe(false)
    expect(isExternalIntentCandidate('酒' + '很长的描述'.repeat(30))).toBe(false)
  })

  it('prompt 含问题原文与 7 类枚举', () => {
    const prompt = buildExternalIntentPrompt('酒和头孢能吃吗')
    expect(prompt).toContain('酒和头孢能吃吗')
    expect(prompt).toContain('external-substance-interaction')
    expect(prompt).toContain('不确定时选 S1')
  })

  it('注入分类器：external → true；not-external → false；抛错 → false（不阻塞）', async () => {
    setExternalIntentClassifier(async () => 'external')
    await expect(shouldAnswerExternalByModel('酒和头孢能吃吗')).resolves.toBe(true)

    setExternalIntentClassifier(async () => 'not-external')
    await expect(shouldAnswerExternalByModel('酒和头孢能吃吗')).resolves.toBe(false)

    setExternalIntentClassifier(async () => {
      throw new Error('deepseek timeout')
    })
    await expect(shouldAnswerExternalByModel('酒和头孢能吃吗')).resolves.toBe(false)
  })

  it('ENABLE_INTENT_MODEL=false → 不调用分类器（整体回滚）', async () => {
    let called = 0
    setExternalIntentClassifier(async () => {
      called += 1
      return 'external'
    })
    process.env.ENABLE_INTENT_MODEL = 'false'
    await expect(shouldAnswerExternalByModel('酒和头孢能吃吗')).resolves.toBe(false)
    expect(called).toBe(0)
  })
})

describe('API 集成 · 规则漏判时模型兜底', () => {
  it('「酒和头孢能吃吗」（规则漏判）+ 模型判 external → answered + unverified + 0 次 consultAnswer', async () => {
    const calls = newCalls()
    let externalCalls = 0
    setAiClients({
      ...mockClients({ calls }),
      externalKnowledge: async () => {
        externalCalls += 1
        return { sections: SAFE_RAW, modelLabel: 'baichuan-m3-plus' }
      },
    })
    setExternalIntentClassifier(async () => 'external')

    const res = await req('POST', '/api/consult', {
      question: '酒和头孢能吃吗',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('answered')
    expect(res.body.notice).toContain('AI 生成')
    expect(res.body.citations[0]?.unverified).toBe(true)
    expect(calls.consultAnswer).toBe(0)
    expect(externalCalls).toBe(1)

    const [log] = await db
      .select()
      .from(consultLogs)
      .where(and(eq(consultLogs.userId, USER), eq(consultLogs.question, '酒和头孢能吃吗')))
    expect(log?.status).toBe('answered')
  })

  it('模型判 not-external → 回落 no-source（不改道）', async () => {
    const calls = newCalls()
    let externalCalls = 0
    setAiClients({
      ...mockClients({ calls }),
      externalKnowledge: async () => {
        externalCalls += 1
        return { sections: SAFE_RAW, modelLabel: 'baichuan-m3-plus' }
      },
    })
    setExternalIntentClassifier(async () => 'not-external')

    const res = await req('POST', '/api/consult', {
      question: '头孢配酒可以吗',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.body.status).toBe('no-source')
    expect(externalCalls).toBe(0)
  })

  it('模型抛错 → 回落 no-source（200，不 500）', async () => {
    const calls = newCalls()
    setAiClients({ ...mockClients({ calls }) })
    setExternalIntentClassifier(async () => {
      throw new Error('deepseek 5xx')
    })

    const res = await req('POST', '/api/consult', {
      question: '酒和头孢能吃吗',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('no-source')
  })

  it('ENABLE_INTENT_MODEL=false → 不调模型，回落 no-source', async () => {
    const calls = newCalls()
    let classified = 0
    setAiClients({ ...mockClients({ calls }) })
    setExternalIntentClassifier(async () => {
      classified += 1
      return 'external'
    })
    process.env.ENABLE_INTENT_MODEL = 'false'

    const res = await req('POST', '/api/consult', {
      question: '酒和头孢能吃吗',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.body.status).toBe('no-source')
    expect(classified).toBe(0)
  })

  it('ENABLE_EXTERNAL_KNOWLEDGE=false（kill switch）优先于模型判定', async () => {
    const calls = newCalls()
    let classified = 0
    let externalCalls = 0
    setAiClients({
      ...mockClients({ calls }),
      externalKnowledge: async () => {
        externalCalls += 1
        return { sections: SAFE_RAW, modelLabel: 'baichuan-m3-plus' }
      },
    })
    setExternalIntentClassifier(async () => {
      classified += 1
      return 'external'
    })
    process.env.ENABLE_EXTERNAL_KNOWLEDGE = 'false'

    const res = await req('POST', '/api/consult', {
      question: '酒和头孢能吃吗',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.body.status).toBe('no-source')
    expect(classified).toBe(0)
    expect(externalCalls).toBe(0)
  })
})
