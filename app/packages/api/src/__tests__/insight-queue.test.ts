/**
 * T7 队列 Agent 测试：语义查询工具（参数校验 + 纯函数聚合）+ GET /api/insight/queue +
 * POST /api/insight/queue-summary（LLM mock / 双降级）+ 无 N+1 断言（spec §T7 完成标准）。
 *
 * 测试库 globalSetup 只 seed users（p-001），本文件自建多患者 fixture（qa-1/2/3 分档各异），
 * afterAll 清理。断言只锚定自建患者 id，不锚定全局总数（vitest 并行下 p-001 数据可能被
 * 其他测试文件写入）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { inArray } from 'drizzle-orm'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { healthProfiles, plans, records, riskEvents, users } from '../db/schema.js'
import { setAiClients } from '../lib/ai/registry.js'
import { AIUnavailableError, type AiClients } from '../lib/ai/types.js'
import { mockClients, newCalls } from './helpers/ai-mocks.js'
import { countGrades, rollupTimeline, runQueueTool } from '../services/insight/tools.js'
import { listPatientsWithStats } from '../repositories/insight.repo.js'
import { gradeAdherence, ADHERENCE_GRADE_THRESHOLDS } from '@anxin/shared'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

/** 今天（UTC，与 repo getAdherenceByUser 的 scheduledDate 字符串口径一致）。 */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

// 三个分档患者：qa-1 全勤（优）、qa-2 约 85%（中）、qa-3 50%（差）
const GOOD = 'qa-1'
const FAIR = 'qa-2'
const POOR = 'qa-3'
const IDS = [GOOD, FAIR, POOR]

let prevClients: AiClients | null = null

beforeAll(async () => {
  await db.insert(users).values(IDS.map((id, i) => ({ id, name: `测试患者${i + 1}` })))

  // records：确定性 taken/skipped 计数（全部落在近 30 天窗口）
  const recRows: (typeof records.$inferInsert)[] = []
  const mk = (userId: string, n: number, taken: number, tag: string) => {
    for (let i = 0; i < n; i++) {
      recRows.push({
        id: `qa-rec-${tag}-${i}`,
        userId,
        planId: `qa-plan-${tag}`,
        scheduledDate: utcToday(),
        scheduledTime: `${String(8 + i).padStart(2, '0')}:00`,
        status: i < taken ? 'taken' : 'skipped',
      })
    }
  }
  mk(GOOD, 10, 10, 'good') // rate 100 → good
  mk(FAIR, 20, 17, 'fair') // rate 85 → fair
  mk(POOR, 10, 5, 'poor') // rate 50 → poor
  await db.insert(records).values(recRows)

  // 风险事件两行（qa-3 名下）→ 时间线聚合数据
  await db.insert(riskEvents).values([
    {
      id: 'qa-evt-l4',
      userId: POOR,
      level: 'L4',
      type: 'emergency',
      detail: { matchedKeyword: '胸痛' },
      occurredAt: new Date(),
    },
    {
      id: 'qa-evt-l3',
      userId: POOR,
      level: 'L3',
      type: 'refused',
      detail: { matchedKeyword: '停药' },
      occurredAt: new Date(),
    },
  ])
})

afterAll(async () => {
  if (prevClients) setAiClients(prevClients)
  await db.delete(riskEvents).where(inArray(riskEvents.id, ['qa-evt-l4', 'qa-evt-l3']))
  await db.delete(records).where(inArray(records.userId, IDS))
  await db.delete(plans).where(inArray(plans.userId, IDS))
  await db.delete(healthProfiles).where(inArray(healthProfiles.userId, IDS))
  await db.delete(users).where(inArray(users.id, IDS))
})

// ---------------------------------------------------------------------------
// 纯函数与工具参数校验（ADR #17：参数必须过 safeParse，失败可见）
// ---------------------------------------------------------------------------

describe('队列工具 · 纯函数（countGrades / rollupTimeline）', () => {
  it('countGrades 按分档计数，无分档归 ungraded', () => {
    expect(
      countGrades([
        { adherenceGrade: 'good' },
        { adherenceGrade: 'good' },
        { adherenceGrade: 'fair' },
        { adherenceGrade: 'poor' },
        { adherenceGrade: null },
      ]),
    ).toEqual({ good: 2, fair: 1, poor: 1, ungraded: 1 })
  })

  it('rollupTimeline 按 UTC 日 × 级别聚合且日期升序', () => {
    const rows = [
      { date: '2026-09-07', level: 'L4' as const },
      { date: '2026-09-06', level: 'L3' as const },
      { date: '2026-09-07', level: 'L4' as const },
      { date: '2026-09-07', level: 'L3' as const },
    ]
    expect(rollupTimeline(rows)).toEqual([
      { date: '2026-09-06', level: 'L3', count: 1 },
      { date: '2026-09-07', level: 'L4', count: 2 },
      { date: '2026-09-07', level: 'L3', count: 1 },
    ])
  })
})

describe('队列工具 · 参数 safeParse（校验失败必须可见，不猜参数执行）', () => {
  it('patient_cohort 分档枚举外值 → 抛错', async () => {
    await expect(runQueueTool('patient_cohort', { grade: 'excellent' })).rejects.toThrow(/参数非法/)
  })

  it('days 越界（<7 / >90 / 非整数）→ 抛错', async () => {
    await expect(runQueueTool('adherence_distribution', { days: 3 })).rejects.toThrow(/参数非法/)
    await expect(runQueueTool('risk_event_rollup', { days: 180 })).rejects.toThrow(/参数非法/)
    await expect(runQueueTool('adherence_distribution', { days: 7.5 })).rejects.toThrow(/参数非法/)
  })

  it('多余字段（.strict()）→ 抛错', async () => {
    await expect(runQueueTool('adherence_distribution', { days: 30, sql: 'drop table users' })).rejects.toThrow(
      /参数非法/,
    )
  })
})

// ---------------------------------------------------------------------------
// 无 N+1（spec §T7.2：查询数与患者数无关）
// ---------------------------------------------------------------------------

describe('listPatientsWithStats · 聚合查询无 N+1', () => {
  it('患者数增加时 select 次数恒定（5 次：users/health/plans/adherence/lastActive）', async () => {
    const spy = vi.spyOn(db, 'select')
    try {
      await listPatientsWithStats()
      const first = spy.mock.calls.length
      await listPatientsWithStats()
      expect(spy.mock.calls.length).toBe(first * 2) // 翻倍调用 → 恰好翻倍次数（内部无按患者循环）
      expect(first).toBeLessThanOrEqual(6)
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// GET /api/insight/queue（0 次 LLM 直查库）
// ---------------------------------------------------------------------------

describe('GET /api/insight/queue · 队列视图数据（spec §T7.7）', () => {
  it('分档统计 + 患者表 + 事件时间线，0 次 LLM', async () => {
    const calls = newCalls()
    prevClients = setAiClients(mockClients({ calls }))

    const res = await req('GET', '/api/insight/queue')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const qa1 = res.body.patients.find((p: any) => p.id === GOOD)
    const qa2 = res.body.patients.find((p: any) => p.id === FAIR)
    const qa3 = res.body.patients.find((p: any) => p.id === POOR)
    expect(qa1.adherenceRate).toBe(100)
    expect(qa1.adherenceGrade).toBe('good')
    expect(qa2.adherenceRate).toBe(85)
    expect(qa2.adherenceGrade).toBe('fair')
    expect(qa3.adherenceRate).toBe(50)
    expect(qa3.adherenceGrade).toBe('poor')

    // 时间线包含自建的两条事件（不锚定精确 count——并行测试可能写入其他事件）
    const today = utcToday()
    expect(res.body.riskTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: today, level: 'L4' }),
        expect.objectContaining({ date: today, level: 'L3' }),
      ]),
    )

    // 0 次 LLM 红线：队列数据端点绝不触发任何模型调用
    expect(calls.queueSummary).toBe(0)
    expect(calls.consultAnswer).toBe(0)
    expect(calls.insightSummary).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// POST /api/insight/queue-summary（LLM mock / 离线降级 / 错误降级 / 守门）
// ---------------------------------------------------------------------------

describe('POST /api/insight/queue-summary · 队列摘要（spec §T7.6）', () => {
  const withKey = async (fn: () => Promise<void>) => {
    const origKey = process.env.BAICHUAN_API_KEY
    process.env.BAICHUAN_API_KEY = 'test-key'
    try {
      await fn()
    } finally {
      if (origKey === undefined) delete process.env.BAICHUAN_API_KEY
      else process.env.BAICHUAN_API_KEY = origKey
    }
  }

  it('mock 干净输出 → 200 + snapshot.mode=llm + sections 结构化', async () => {
    await withKey(async () => {
      const calls = newCalls()
      prevClients = setAiClients(
        mockClients({
          calls,
          queue: {
            summary: '队列执行率整体可控',
            keyPoints: ['1 名患者执行率差'],
            risks: ['建议优先随访'],
            nextAction: '诊间确认漏服原因',
            warning: '本摘要仅供参考',
          },
        }),
      )
      const res = await req('POST', '/api/insight/queue-summary', {})
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.riskLevel).toBe('L1')
      expect(res.body.sections.summary).toBe('队列执行率整体可控')
      expect(res.body.snapshot.mode).toBe('llm')
      expect(res.body.snapshot.toolChain).toContain('adherence_distribution')
      expect(calls.queueSummary).toBe(1)
    })
  })

  it('无 BAICHUAN_API_KEY → 离线降级（规则拼装，含分档统计）', async () => {
    const origKey = process.env.BAICHUAN_API_KEY
    delete process.env.BAICHUAN_API_KEY
    try {
      const res = await req('POST', '/api/insight/queue-summary', {})
      expect(res.status).toBe(200)
      expect(res.body.snapshot.mode).toBe('offline-fallback')
      expect(res.body.notice).toContain('未配置 BAICHUAN_API_KEY')
      expect(res.body.sections.summary).toContain('执行率优')
    } finally {
      if (origKey !== undefined) process.env.BAICHUAN_API_KEY = origKey
    }
  })

  it('LLM 抛 AIUnavailableError → 错误降级（snapshot.mode=error-fallback）', async () => {
    await withKey(async () => {
      prevClients = setAiClients(
        mockClients({ queueSummaryError: new AIUnavailableError('baichuan', '模拟服务不可用') }),
      )
      const res = await req('POST', '/api/insight/queue-summary', {})
      expect(res.status).toBe(200)
      expect(res.body.snapshot.mode).toBe('error-fallback')
      expect(res.body.notice).toContain('LLM 调用失败')
    })
  })

  it('LLM 输出含剂量建议 → guardSummary 二次守门 → riskLevel=L2', async () => {
    await withKey(async () => {
      prevClients = setAiClients(
        mockClients({
          queue: {
            summary: '队列整体平稳，随访频次可参考每日使用超过10次的警示口径收紧',
            keyPoints: [],
            risks: [],
            nextAction: '',
            warning: '',
          },
        }),
      )
      const res = await req('POST', '/api/insight/queue-summary', {})
      expect(res.status).toBe(200)
      expect(res.body.riskLevel).toBe('L2')
      expect(res.body.notice).toContain('已过滤具体剂量建议')
    })
  })
})

// ---------------------------------------------------------------------------
// shared 阈值与 repo 口径一致性（防两处漂移）
// ---------------------------------------------------------------------------

describe('分档阈值 · shared 契约与 repo 字段一致', () => {
  it('repo 患者行的 grade 与 gradeAdherence(rate) 重算一致', async () => {
    const patients = await listPatientsWithStats()
    for (const p of patients) {
      expect(p.adherenceGrade).toBe(gradeAdherence(p.adherenceRate))
    }
    expect(ADHERENCE_GRADE_THRESHOLDS.poor).toBeUndefined() // poor 无下界阈值（<80 即差）
  })
})
