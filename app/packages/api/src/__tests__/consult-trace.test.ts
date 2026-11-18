/**
 * 咨询路由轨迹单测（M13-T2 · docs/14 §4 T2；specs/16 T2）。
 *
 * 覆盖：
 * - resolveSkillRoute 的 steps：守门命中 / 意图命中 / 仲裁 / skillId 快路径 / 开关关闭；
 * - routeSkill 语义不变（resolve 的薄包装）→ 既有 registry 测试已覆盖，这里只钉 steps；
 * - writeRouteTrace：默认关闭零 I/O、开启写文件且 schema 通过、失败可见；
 * - 零 PII：trace JSON 不含问题原文/手机号。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatSkillRoute, resolveSkillRoute } from '../services/consult/registry.js'
import {
  ROUTE_TRACE_VERSION,
  ROUTE_VERSION,
  RouteTraceSchema,
  writeRouteTrace,
  type RouteTrace,
} from '../services/consult/trace.js'

const FLAG = 'CONSULT_ROUTE_TRACE'
const originalFlag = process.env[FLAG]

afterEach(() => {
  if (originalFlag === undefined) delete process.env[FLAG]
  else process.env[FLAG] = originalFlag
})

/** 用真实路由结果构造一轮 trace（与 consult.service.ts 同款组装）。 */
function buildTrace(question: string): RouteTrace {
  const { decision, steps, intentCandidates, lowConfidence, lowConfidenceReason } = resolveSkillRoute({
    question,
    intentRouteEnabled: true,
    skillId: null,
  })
  return {
    v: ROUTE_TRACE_VERSION,
    routeVersion: ROUTE_VERSION,
    consultLogId: 'clog-test',
    createdAt: '2026-11-18T00:00:00.000Z',
    steps: [
      { layer: 'input', outcome: 'scrubbed', detail: { drugCount: 1, conditionsCount: 0 } },
      ...steps,
      { layer: 'execute', outcome: 'answered', detail: { skill: decision.skill, llmPath: true } },
    ],
    finalRoute: formatSkillRoute(decision),
    llmPath: true,
    status: 'answered',
    intent: null,
    intentCandidates,
    lowConfidence,
    lowConfidenceReason,
  }
}

describe('resolveSkillRoute · trace steps', () => {
  it('L4 口语变体「孩子误服了怎么办」→ guard emergency 步骤 + S0/emergency', () => {
    const { decision, steps } = resolveSkillRoute({
      question: '孩子误服了怎么办',
      intentRouteEnabled: true,
    })
    expect(decision).toEqual({ skill: 'S0', kind: 'emergency', matched: '孩子误服' })
    expect(steps[0]).toEqual({ layer: 'guard', outcome: 'emergency', detail: { matched: '孩子误服' } })
    expect(steps.at(-1)).toEqual({ layer: 'route', outcome: 'S0/emergency' })
  })

  it('行动词仲裁「药过期了还能吃吗」→ intent veto:advice 步骤 + S1', () => {
    const { decision, steps } = resolveSkillRoute({
      question: '药过期了还能吃吗',
      intentRouteEnabled: true,
    })
    expect(decision).toEqual({ skill: 'S1' })
    expect(steps).toContainEqual({ layer: 'intent', outcome: 'veto:advice' })
    expect(steps.at(-1)).toEqual({ layer: 'route', outcome: 'S1' })
  })

  it('S2 命中「我现在有多少药物」→ intent S2-hit（含意图与规则 label）', () => {
    const { decision, steps, intentCandidates, lowConfidence } = resolveSkillRoute({
      question: '我现在有多少药物',
      intentRouteEnabled: true,
    })
    expect(decision).toEqual({ skill: 'S2', intent: 'medication-list' })
    const hit = steps.find((s) => s.outcome === 'S2-hit')
    expect(hit?.detail).toMatchObject({ intent: 'medication-list' })
    // T6 观测：候选固定 5 个、强问法不低置信
    expect(intentCandidates).toHaveLength(5)
    expect(intentCandidates.find((c) => c.intent === 'medication-list')?.score).toBeGreaterThanOrEqual(80)
    expect(lowConfidence).toBe(false)
  })

  it('T6：解释类仲裁样本 → S1 且低置信（veto:explain）', () => {
    const { decision, lowConfidence, lowConfidenceReason } = resolveSkillRoute({
      question: '这个药有什么副作用',
      intentRouteEnabled: true,
    })
    expect(decision).toEqual({ skill: 'S1' })
    expect(lowConfidence).toBe(true)
    expect(lowConfidenceReason).toBe('veto:explain')
  })

  it('skillId 快路径 → intent skillId 步骤（不受开关影响）', () => {
    const { decision, steps } = resolveSkillRoute({
      question: '今天吃啥呀',
      intentRouteEnabled: false,
      skillId: 's2-next-dose',
    })
    expect(decision).toEqual({ skill: 'S2', intent: 'next-dose' })
    expect(steps).toContainEqual({ layer: 'intent', outcome: 'skillId', detail: { skillId: 's2-next-dose' } })
  })

  it('开关关闭 → intent disabled 步骤 + S1', () => {
    const { decision, steps } = resolveSkillRoute({
      question: '我现在有多少药物',
      intentRouteEnabled: false,
    })
    expect(decision).toEqual({ skill: 'S1' })
    expect(steps).toContainEqual({ layer: 'intent', outcome: 'disabled' })
  })
})

describe('writeRouteTrace', () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true })
      dir = null
    }
  })

  it('默认关闭 → 返回 null（零 I/O）', async () => {
    delete process.env[FLAG]
    expect(await writeRouteTrace(buildTrace('我胸痛'))).toBeNull()
  })

  it('开启 → 写文件且 schema 校验通过；JSON 不含问题原文与手机号', async () => {
    process.env[FLAG] = '1'
    dir = await mkdtemp(join(tmpdir(), 'anxin-route-trace-'))
    const question = '我胸痛，手机号13812345678'
    const trace = buildTrace(question)
    const file = await writeRouteTrace(trace, { dir })
    expect(file).not.toBeNull()

    const raw = await readFile(file as string, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    expect(RouteTraceSchema.safeParse(parsed).success).toBe(true)
    expect(raw).not.toContain(question)
    expect(raw).not.toContain('13812345678')
    expect(raw).toContain('clog-test')
  })

  it('schema 非法（steps 为空）→ 显式抛错（失败可见不静默）', async () => {
    process.env[FLAG] = '1'
    const bad = { ...buildTrace('我胸痛'), steps: [] } as unknown as RouteTrace
    dir = await mkdtemp(join(tmpdir(), 'anxin-route-trace-'))
    await expect(writeRouteTrace(bad, { dir })).rejects.toThrow(/route trace/)
  })
})

describe('formatSkillRoute', () => {
  it('三类决策的稳定字符串', () => {
    expect(formatSkillRoute({ skill: 'S0', kind: 'emergency', matched: '胸痛' })).toBe('S0/emergency')
    expect(formatSkillRoute({ skill: 'S2', intent: 'expiry-stock' })).toBe('S2/expiry-stock')
    expect(formatSkillRoute({ skill: 'S1' })).toBe('S1')
  })
})
