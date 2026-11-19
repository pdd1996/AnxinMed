/**
 * 外部知识兜底（M14 演示版）——纯函数 + API 集成测试。
 *
 * 覆盖：
 * - 触发范围：只认「物质 + 同服问法 + 药品语境」，剂量问题不走本层；
 * - 模型输出安全清洗：剂量/绝对安全/停换药/诊断 → 整段弃用；
 * - 成功路径：status=answered + 「AI 生成，仅供参考」notice + unverified 引用 + 0 次 consultAnswer；
 * - 失败/不合格路径：回退固定通用提示（notice 明确 AI 不可用，不冒充 AI）；
 * - kill switch：ENABLE_EXTERNAL_KNOWLEDGE=false → 回退既有 no-source。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { consultLogs } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients } from '../lib/ai/types.js'
import {
  EXTERNAL_AI_DISCLAIMER,
  answerExternalKnowledge,
  buildFallbackSections,
  sanitizeExternalSections,
  shouldAnswerExternalKnowledge,
} from '../services/consult/external.js'
import { buildDeepseekExternalKnowledgeRequest } from '../lib/ai/deepseek.js'
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
const QUESTIONS = ['酒和藿香正气水能一起吃吗', '这个药能喝酒吗']
const prevEnv = process.env.ENABLE_EXTERNAL_KNOWLEDGE
let prevClients: AiClients | null = null

beforeAll(() => {
  prevClients = setAiClients(mockClients({}))
})

afterEach(() => {
  if (prevEnv === undefined) delete process.env.ENABLE_EXTERNAL_KNOWLEDGE
  else process.env.ENABLE_EXTERNAL_KNOWLEDGE = prevEnv
  prevClients = setAiClients(mockClients({}))
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await db
    .delete(consultLogs)
    .where(and(eq(consultLogs.userId, USER), inArray(consultLogs.question, QUESTIONS)))
})

const SAFE_RAW = {
  summary: '酒和藿香正气水不建议一起服用。',
  keyPoints: ['藿香正气水通常含乙醇，与酒同服会增加酒精摄入。', '如同时在服用头孢类，需警惕双硫仑样反应。'],
  risks: ['同服可能增加头晕、心悸等不适风险。'],
  nextAction: '请咨询医生或药师；如有不适及时就医。',
  warning: '不要自行调整用药。',
}

describe('shouldAnswerExternalKnowledge · 触发范围（纯函数）', () => {
  it('命中：酒/藿香正气水 + 同服问法', () => {
    expect(shouldAnswerExternalKnowledge('酒和藿香正气水能一起吃吗')).toBe(true)
    expect(shouldAnswerExternalKnowledge('吃头孢的时候能喝酒吗')).toBe(true)
    expect(shouldAnswerExternalKnowledge('西柚和他汀能一起吃吗')).toBe(true)
  })

  it('不命中：剂量问题、非药品物质、无同服语义', () => {
    expect(shouldAnswerExternalKnowledge('这个药每次吃几片')).toBe(false)
    expect(shouldAnswerExternalKnowledge('我今天血压怎么样')).toBe(false)
    expect(shouldAnswerExternalKnowledge('藿香正气水说明书')).toBe(false)
  })
})

describe('A12 对打 · deepseek 外部知识请求', () => {
  it('非思考、温度 0、复用外部知识 prompt', () => {
    const req = buildDeepseekExternalKnowledgeRequest('酒和藿香正气水能一起吃吗')
    expect(req.model).toBe(process.env.DEEPSEEK_MODEL || 'deepseek-flash')
    expect(req.temperature).toBe(0)
    expect(req.thinking).toEqual({ type: 'disabled' })
    expect(req.messages[0].content).toContain('酒和藿香正气水能一起吃吗')
  })
})

describe('sanitizeExternalSections · 安全清洗', () => {
  it('合规输出保留；warning 只留安全提示（AI 声明由 notice 统一展示）', () => {
    const s = sanitizeExternalSections(SAFE_RAW)
    expect(s).not.toBeNull()
    expect(s!.summary).toContain('不建议一起服用')
    expect(s!.warning).toContain('不要自行调整用药')
    expect(s!.warning).not.toContain('AI 生成')
  })

  it('清除模型漏出的引用标记 ^[1]^ / [1]（验收发现：展示成裸文本）', () => {
    const s = sanitizeExternalSections({
      ...SAFE_RAW,
      summary: '不建议一起服用 ^[1]^。',
      keyPoints: ['藿香正气水含乙醇（40%～50%）[1]'],
    })
    expect(s).not.toBeNull()
    expect(s!.summary).not.toContain('^[1]^')
    expect(s!.summary).not.toContain('[1]')
    expect(s!.keyPoints.join('')).not.toContain('[1]')
  })

  it('warning 只有 AI 声明时回退默认安全提示（不出现重复免责）', () => {
    const s = sanitizeExternalSections({ ...SAFE_RAW, warning: 'AI 生成，仅供参考，请咨询医生或药师。' })
    expect(s).not.toBeNull()
    expect(s!.warning).toContain('不要自行调整用药')
    expect(s!.warning).not.toContain('AI 生成')
  })

  it('出现剂量 → 整段弃用', () => {
    expect(sanitizeExternalSections({ ...SAFE_RAW, keyPoints: ['每次 2 片，每日 3 次'] })).toBeNull()
  })

  it('中文数字剂量指令仍拦（每日三次 / 每次一片 / 剂量为 5mg）', () => {
    expect(sanitizeExternalSections({ ...SAFE_RAW, keyPoints: ['每日三次，每次一片'] })).toBeNull()
    expect(sanitizeExternalSections({ ...SAFE_RAW, keyPoints: ['剂量为 5mg，疗程两周'] })).toBeNull()
    expect(sanitizeExternalSections({ ...SAFE_RAW, nextAction: '一天最多两次，分 2 次服用' })).toBeNull()
  })

  it('风险解释里的「剂量」不算剂量指令（百川误杀回归）', () => {
    const s = sanitizeExternalSections({
      ...SAFE_RAW,
      risks: ['双硫仑样反应的严重程度与药物剂量和饮酒量成正比。'],
    })
    expect(s).not.toBeNull()
    expect(s!.risks.join('')).toContain('剂量')

    const s2 = sanitizeExternalSections({
      ...SAFE_RAW,
      risks: ['尤其在大剂量使用他汀时，肌病风险更高。'],
    })
    expect(s2).not.toBeNull()
  })

  it('清除 Markdown 加粗/斜体/代码标记（百川输出带 **加粗**）', () => {
    const s = sanitizeExternalSections({
      ...SAFE_RAW,
      summary: '**不建议**同时服用。',
      keyPoints: ['`藿香正气水` 含乙醇 __40%__。'],
    })
    expect(s).not.toBeNull()
    expect(s!.summary).not.toContain('**')
    expect(s!.summary).toContain('不建议同时服用')
    expect(s!.keyPoints.join('')).not.toContain('`')
    expect(s!.keyPoints.join('')).not.toContain('_')
  })

  it('出现「可以一起/放心」等绝对安全表述 → 整段弃用', () => {
    expect(sanitizeExternalSections({ ...SAFE_RAW, summary: '可以一起服用，放心。' })).toBeNull()
  })

  it('出现停换药/诊断表述 → 整段弃用', () => {
    expect(sanitizeExternalSections({ ...SAFE_RAW, nextAction: '建议停药观察' })).toBeNull()
  })
})

describe('buildFallbackSections · 固定通用提示', () => {
  it('酒精 + 藿香 → 含乙醇与双硫仑提示', () => {
    const s = buildFallbackSections('酒和藿香正气水能一起吃吗')
    expect(s.summary).toContain('不建议')
    expect(s.keyPoints.join('')).toContain('双硫仑')
    expect(s.warning).toContain('通用安全提示')
  })
})

describe('answerExternalKnowledge · 模型成败路径（不连外网）', () => {
  it('模型返回合规内容 → source=ai，notice=AI 免责', async () => {
    const ai: AiClients = { ...mockClients({}), externalKnowledge: async () => ({ sections: SAFE_RAW, modelLabel: 'qwen3.8-flash' }) }
    const r = await answerExternalKnowledge(ai, '酒和藿香正气水能一起吃吗')
    expect(r.source).toBe('ai')
    expect(r.result.notice).toBe(EXTERNAL_AI_DISCLAIMER)
    expect(r.result.citations[0]?.unverified).toBe(true)
  })

  it('模型抛错 → source=fallback，notice 明确 AI 不可用且不冒充 AI', async () => {
    const ai: AiClients = {
      ...mockClients({}),
      externalKnowledge: async () => {
        throw new Error('AI down')
      },
    }
    const r = await answerExternalKnowledge(ai, '酒和藿香正气水能一起吃吗')
    expect(r.source).toBe('fallback')
    expect(r.result.notice).toContain('AI 服务暂不可用')
    expect(r.result.notice).toContain('通用用药安全提示')
    expect(r.result.citations[0]?.source).toContain('人工配置')
  })

  it('候选链：主模型输出过不了清洗 → 自动换下一个，引用标实际模型', async () => {
    const ai: AiClients = {
      ...mockClients({}),
      externalKnowledgeFallbacks: () => [
        { label: 'baichuan-m3-plus', call: async () => ({ sections: { ...SAFE_RAW, warning: '每天 3 次' }, modelLabel: 'baichuan-m3-plus' }) },
        { label: 'qwen3.8-flash', call: async () => ({ sections: SAFE_RAW, modelLabel: 'qwen3.8-flash' }) },
      ],
    }
    const r = await answerExternalKnowledge(ai, '酒和藿香正气水能一起吃吗')
    expect(r.source).toBe('ai')
    expect(r.result.citations[0]?.version).toContain('qwen3.8-flash')
  })

  it('候选链：主模型抛错 → 次模型兜住；全部失败 → 固定提示', async () => {
    const ok: AiClients = {
      ...mockClients({}),
      externalKnowledgeFallbacks: () => [
        { label: 'baichuan-m3-plus', call: async () => { throw new Error('429') } },
        { label: 'qwen3.8-flash', call: async () => ({ sections: SAFE_RAW, modelLabel: 'qwen3.8-flash' }) },
      ],
    }
    const r = await answerExternalKnowledge(ok, '酒和藿香正气水能一起吃吗')
    expect(r.source).toBe('ai')

    const allBad: AiClients = {
      ...mockClients({}),
      externalKnowledgeFallbacks: () => [
        { label: 'baichuan-m3-plus', call: async () => { throw new Error('429') } },
        { label: 'qwen3.8-flash', call: async () => ({ sections: { ...SAFE_RAW, keyPoints: ['每次 2 片'] }, modelLabel: 'qwen3.8-flash' }) },
      ],
    }
    const r2 = await answerExternalKnowledge(allBad, '酒和藿香正气水能一起吃吗')
    expect(r2.source).toBe('fallback')
    expect(r2.result.notice).toContain('AI 服务暂不可用')
  })
})

describe('API 集成 · 外部知识兜底', () => {
  it('「酒和藿香正气水能一起吃吗」→ answered + AI 免责 + unverified 引用 + 0 次 consultAnswer', async () => {
    const calls = newCalls()
    let externalCalls = 0
    const ai: AiClients = {
      ...mockClients({ calls }),
      externalKnowledge: async () => {
        externalCalls += 1
        return { sections: SAFE_RAW, modelLabel: 'qwen3.8-flash' }
      },
    }
    setAiClients(ai)

    const res = await req('POST', '/api/consult', {
      question: '酒和藿香正气水能一起吃吗',
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
      .where(and(eq(consultLogs.userId, USER), eq(consultLogs.question, '酒和藿香正气水能一起吃吗')))
    expect(log?.status).toBe('answered')
  })

  it('模型输出含剂量 → 回退固定提示，不把模型文本透出', async () => {
    const calls = newCalls()
    const ai: AiClients = {
      ...mockClients({ calls }),
      externalKnowledge: async () => ({
          sections: { ...SAFE_RAW, summary: '每次 1 支，每日 2 次即可。' },
          modelLabel: 'qwen3.8-flash',
        }),
    }
    setAiClients(ai)

    const res = await req('POST', '/api/consult', {
      question: '酒和藿香正气水能一起吃吗',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.body.status).toBe('answered')
    expect(res.body.notice).toContain('AI 服务暂不可用')
    expect(res.body.answer).not.toContain('每次 1 支')
  })

  it('ENABLE_EXTERNAL_KNOWLEDGE=false → 回退既有 no-source（kill switch）', async () => {
    process.env.ENABLE_EXTERNAL_KNOWLEDGE = 'false'
    const calls = newCalls()
    let externalCalls = 0
    setAiClients({
      ...mockClients({ calls }),
      externalKnowledge: async () => {
        externalCalls += 1
        return { sections: SAFE_RAW, modelLabel: 'qwen3.8-flash' }
      },
    })

    const res = await req('POST', '/api/consult', {
      question: '酒和藿香正气水能一起吃吗',
      drugIds: [],
      consultStatusVersion: 2,
    })

    expect(res.body.status).toBe('no-source')
    expect(externalCalls).toBe(0)
    expect(calls.consultAnswer).toBe(0)
  })
})
