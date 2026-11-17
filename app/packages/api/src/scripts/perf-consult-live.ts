/**
 * M12 · Live 长稳/成本采样（真实咨询全链：取数 + 守门 + LLM + 归一化 + 留痕写库）。
 *
 * 与 perf:consult（模型瞬时 mock，只测骨架）互补：本脚本跑真实模型，产出端到端延迟、
 * 失败率、token 用量与成本，并支持「持续时长」模式验证长稳（默认 N=50；给
 * PERF_DURATION_SEC=600 时至少跑满 10 分钟，N 只作下限——两者取更长者）。
 *
 * token 采集：脚本包一层全局 fetch，只旁路读取 chat/completions 响应的 usage 字段
 * （OpenAI 兼容），不改生产代码、不改请求；重试造成的多次计费也计入总量。
 *
 * 临时用户 p-live-perf + 一条 reviewed 说明书 + 一条 active 计划；采样后清理，不留业务数据。
 *
 * 运行：
 *   pnpm --filter @anxin/api perf:consult-live
 *   PERF_N=50 PERF_DURATION_SEC=600 pnpm --filter @anxin/api perf:consult-live
 *
 * 可调 env：
 *   PERF_N                 样本下限（默认 50）
 *   PERF_DURATION_SEC      持续秒数（默认 0 = 只跑到 N；>0 时同时满足 N 与时长）
 *   PERF_MAX_N             硬上限（默认 400，防止模型极快时空转烧钱）
 *   PERF_PAUSE_MS          样本间隔（默认 0）
 *   PERF_MAX_CONSEC_FAIL   连续失败熔断（默认 5）
 *   CONSULT_PRICE_INPUT_PER_M / CONSULT_PRICE_OUTPUT_PER_M
 *                          元/百万 token；两项都填才输出金额（仓库内无价目表，不猜单价）
 *
 * 输出（本地，gitignored）：
 *   data/m12-reports/consult-live-longrun.json   全量样本 + 聚合
 *   data/m12-reports/consult-live-longrun.md     人读报告
 *   data/m12-reports/consult-live-perf.json      兼容 M12 §2.3 的旧摘要
 */
import '../lib/env.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import {
  consultLogs,
  consultSessions,
  consultSuggestions,
  drugs,
  plans,
  riskEvents,
  users,
} from '../db/schema.js'
import { consult } from '../services/consult.service.js'
import { percentile } from '../lib/timing.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')

const USER = 'p-live-perf'
const DRUG = 'live-drug-perf'
const PLAN = 'live-plan-perf'
const MASTER = 'drug-ruishufatatinggai-pian-5mg-h20180007'
const QUESTION = '吃瑞舒伐他汀钙片期间要注意什么？'

/** env 数字解析：空/非法 → null（不静默当 0）。 */
function numOrNull(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const N = Math.max(1, Math.trunc(numOrNull(process.env.PERF_N) ?? 50))
const DURATION_SEC = Math.max(0, numOrNull(process.env.PERF_DURATION_SEC) ?? 0)
const MAX_N = Math.max(N, Math.trunc(numOrNull(process.env.PERF_MAX_N) ?? 400))
const PAUSE_MS = Math.max(0, numOrNull(process.env.PERF_PAUSE_MS) ?? 0)
const MAX_CONSEC_FAIL = Math.max(1, Math.trunc(numOrNull(process.env.PERF_MAX_CONSEC_FAIL) ?? 5))
const PRICE_INPUT_PER_M = numOrNull(process.env.CONSULT_PRICE_INPUT_PER_M)
const PRICE_OUTPUT_PER_M = numOrNull(process.env.CONSULT_PRICE_OUTPUT_PER_M)

const round1 = (n: number): number => Math.round(n * 10) / 10

// ---------------------------------------------------------------------------
// 抓取模型 usage：旁路包装全局 fetch（生产代码零改动；只读响应副本）
// ---------------------------------------------------------------------------

interface LlmAttempt {
  /** 相对本次采样起点的毫秒数。 */
  atMs: number
  durMs: number
  status: number
  ok: boolean
}

interface UsageTicket {
  atMs: number
  prompt: number
  completion: number
  total: number
  cached: number
  reasoning: number
  model: string | null
}

const llmAttempts: LlmAttempt[] = []
const usageTickets: UsageTicket[] = []
const httpStatuses: Record<string, number> = {}
let pendingParses: Promise<void>[] = []
let clockOrigin = performance.now()

const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  const [input, init] = args
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const isChat = url.includes('/chat/completions')
  const started = performance.now()
  const res = await realFetch(input, init)
  if (isChat) {
    httpStatuses[String(res.status)] = (httpStatuses[String(res.status)] ?? 0) + 1
    llmAttempts.push({
      atMs: started - clockOrigin,
      durMs: performance.now() - started,
      status: res.status,
      ok: res.ok,
    })
    if (res.ok) {
      pendingParses.push(
        res
          .clone()
          .json()
          .then((body: unknown) => {
            const usage = (body as { usage?: Record<string, unknown> } | null)?.usage
            if (!usage) return
            const num = (key: string): number => {
              const v = Number(usage[key] ?? 0)
              return Number.isFinite(v) ? v : 0
            }
            const prompt = num('prompt_tokens')
            const completion = num('completion_tokens')
            const promptDetails = usage.prompt_tokens_details as { cached_tokens?: number } | undefined
            const completionDetails = usage.completion_tokens_details as
              | { reasoning_tokens?: number }
              | undefined
            const model = (body as { model?: unknown } | null)?.model
            usageTickets.push({
              atMs: performance.now() - clockOrigin,
              prompt,
              completion,
              total: num('total_tokens') || prompt + completion,
              cached: Number(promptDetails?.cached_tokens ?? 0),
              reasoning: Number(completionDetails?.reasoning_tokens ?? 0),
              model: typeof model === 'string' ? model : null,
            })
          })
          .catch(() => undefined), // 响应体解析失败不影响主流程；缺 usage 会在报告里标 missing
      )
    }
  }
  return res
}) as typeof fetch

/** 清空本轮采集窗口（warmup 与正式样本分开记账）。 */
async function resetCapture(): Promise<void> {
  await Promise.allSettled(pendingParses)
  llmAttempts.length = 0
  usageTickets.length = 0
  pendingParses = []
  for (const key of Object.keys(httpStatuses)) delete httpStatuses[key]
  clockOrigin = performance.now()
}

// ---------------------------------------------------------------------------
// 采样与清理
// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  await db.delete(consultSuggestions).where(eq(consultSuggestions.userId, USER))
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(consultSessions).where(eq(consultSessions.userId, USER))
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))
  await db.delete(users).where(eq(users.id, USER))
}

interface Sample {
  idx: number
  /** 相对采样起点的秒数。 */
  atSec: number
  latencyMs: number
  ok: boolean
  status: string | null
  riskLevel: string | null
  degraded: boolean
  llmCalls: number
  llmOk: boolean
  llmMs: number | null
  promptTokens: number | null
  completionTokens: number | null
  error: string | null
}

function summarizeWindow(list: Sample[]) {
  const latencies = list.map((s) => s.latencyMs)
  return {
    n: list.length,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    failed: list.filter((s) => !s.ok || s.degraded).length,
    slowOver15s: list.filter((s) => s.latencyMs > 15_000).length,
  }
}

/** 人读报告（Markdown）。 */
function renderMarkdown(summary: Record<string, unknown>): string {
  const s = summary as {
    generatedAt: string
    provider: string
    model: string
    question: string
    config: { n: number; durationSec: number; pauseMs: number }
    durationActualSec: number
    n: number
    endedBy: string
    aborted: string | null
    latencyMs: { p50: number; p90: number; p95: number; p99: number; min: number; max: number; mean: number; slowOver15s: number }
    llmLatencyMs: { n: number; p50: number; p95: number; min: number; max: number }
    failures: { exceptions: number; degraded: number; nonAnswered: number; failureRate: number }
    statuses: Record<string, number>
    tokens: {
      requests: number
      prompt: number
      completion: number
      total: number
      cached: number
      reasoning: number
      avgPromptPerConsult: number
      avgCompletionPerConsult: number
      avgTotalPerConsult: number
      missing: number
    }
    cost: { total: number; perConsult: number; inputPerMillion: number; outputPerMillion: number } | null
    stability: { firstHalf: { p95: number; failed: number; n: number }; secondHalf: { p95: number; failed: number; n: number }; perMinute: Array<{ minute: number; n: number; failed: number; p95: number; avgTokens: number }> }
    warmup: { status: string; notice: string | null; ms: number }
    httpStatuses: Record<string, number>
  }
  const verdict = s.latencyMs.p95 <= 15_000 ? '达标' : '未达标'
  const lines = [
    '# M12 · Live 长稳与成本采样（全链）',
    '',
    `- 生成时间：${s.generatedAt}`,
    `- Provider / 模型：${s.provider} / ${s.model}`,
    `- 采样：N=${s.n}（下限 ${s.config.n}），实际持续 ${s.durationActualSec}s（目标 ${s.config.durationSec}s），间隔 ${s.config.pauseMs}ms`,
    `- 结束方式：${s.endedBy}${s.aborted ? `（中断：${s.aborted}）` : ''}`,
    `- 问题：${s.question}`,
    '',
    '## 1. 延迟（全链，ms）',
    '',
    '| P50 | P90 | P95 | P99 | min | max | mean | >15s |',
    '|---|---|---|---|---|---|---|---|',
    `| ${s.latencyMs.p50} | ${s.latencyMs.p90} | ${s.latencyMs.p95} | ${s.latencyMs.p99} | ${s.latencyMs.min} | ${s.latencyMs.max} | ${s.latencyMs.mean} | ${s.latencyMs.slowOver15s} |`,
    '',
    `目标：全链 P95 ≤ 15000ms → **${verdict}**。模型单次：P50 ${s.llmLatencyMs.p50}ms / P95 ${s.llmLatencyMs.p95}ms（n=${s.llmLatencyMs.n}，目标 ≤4000ms）。`,
    '',
    '## 2. 失败与降级',
    '',
    `- 异常：${s.failures.exceptions}；降级（模型不可用→说明书规则拼装）：${s.failures.degraded}；非 answered 状态：${s.failures.nonAnswered}`,
    `- 失败率（异常+降级）/ 样本：${(s.failures.failureRate * 100).toFixed(2)}%`,
    `- 状态分布：${Object.entries(s.statuses).map(([k, v]) => `${k}=${v}`).join('，') || '-'}`,
    `- HTTP 状态（chat/completions）：${Object.entries(s.httpStatuses).map(([k, v]) => `${k}×${v}`).join('，') || '-'}`,
    '',
    '## 3. 长稳（按分钟）',
    '',
    '| 分钟 | 样本 | 失败 | P95(ms) | 平均 token/次 |',
    '|---|---|---|---|---|',
    ...s.stability.perMinute.map((m) => `| ${m.minute} | ${m.n} | ${m.failed} | ${m.p95} | ${m.avgTokens} |`),
    '',
    `前半程 P95 ${s.stability.firstHalf.p95}ms（失败 ${s.stability.firstHalf.failed}/${s.stability.firstHalf.n}） vs 后半程 P95 ${s.stability.secondHalf.p95}ms（失败 ${s.stability.secondHalf.failed}/${s.stability.secondHalf.n}）。`,
    '',
    '## 4. Token 与成本',
    '',
    '| 项 | 值 |',
    '|---|---|',
    `| 模型请求数（计费次数） | ${s.tokens.requests} |`,
    `| prompt tokens | ${s.tokens.prompt} |`,
    `| completion tokens | ${s.tokens.completion} |`,
    `| total tokens | ${s.tokens.total}（cached ${s.tokens.cached} / reasoning ${s.tokens.reasoning}） |`,
    `| 单次咨询均值 | prompt ${s.tokens.avgPromptPerConsult} / completion ${s.tokens.avgCompletionPerConsult} / total ${s.tokens.avgTotalPerConsult} |`,
    `| 缺 usage 的样本 | ${s.tokens.missing} |`,
  ]
  if (s.cost) {
    lines.push(
      `| 估算成本 | ¥${s.cost.total.toFixed(4)}（单次 ¥${s.cost.perConsult.toFixed(6)}；单价 输入 ${s.cost.inputPerMillion} / 输出 ${s.cost.outputPerMillion} 元每百万 token） |`,
    )
  } else {
    lines.push('| 估算成本 | 未配置 CONSULT_PRICE_INPUT_PER_M / CONSULT_PRICE_OUTPUT_PER_M，按 token 数 × 账户价目表换算 |')
  }
  lines.push(
    '',
    '## 5. 口径与边界',
    '',
    '- **全链**：取数（drugs/plans/说明书/规则/档案）+ 守门 + LLM + normalized + citations + consult_logs/session 写库；不含前端网络与渲染。',
    '- **失败**：异常 = 全链抛错；降级 = 模型不可用后返回规则拼装（`notice` 含「降级/不可用」）；二者都计入失败率，`limited`（L2 剂量过滤）不算失败。',
    '- **token**：旁路读取响应 `usage`；脚本重试的每次成功响应都计入，故为计费口径。warmup 1 次单独记录：' +
      `${s.warmup.status} / ${s.warmup.ms}ms${s.warmup.notice ? ` / ${s.warmup.notice}` : ''}。`,
    '- **成本**：金额依赖账户价目表；仓库无价目，未配置单价时只报 token，不给假金额。',
    '',
  )
  return `${lines.join('\n')}\n`
}

async function main(): Promise<number> {
  await cleanup()
  await db.insert(users).values({ id: USER, name: 'live perf' })
  await db.insert(drugs).values({
    id: DRUG,
    userId: USER,
    genericName: '瑞舒伐他汀钙片',
    specification: '5mg',
    form: '片',
    drugMasterId: MASTER,
    confirmStatus: 'transcribed',
  })
  await db.insert(plans).values({
    id: PLAN,
    userId: USER,
    drugId: DRUG,
    dose: { value: 1, unit: '片' },
    frequency: 1,
    times: ['20:00'],
    cycleType: 'open',
    startDate: '2026-01-01',
    status: 'active',
    source: 'manual',
  })

  // ── warmup（不计入样本；失败/降级则快速中止，避免空烧 10 分钟）──
  await resetCapture()
  const warmT0 = performance.now()
  const warm = await consult(USER, QUESTION, [DRUG])
  const warmMs = round1(performance.now() - warmT0)
  await Promise.allSettled(pendingParses)
  const warmTokens = usageTickets.reduce((sum, t) => sum + t.total, 0)
  console.log(
    `[live-perf] warmup status=${warm.status} ms=${warmMs} tokens=${warmTokens} notice=${warm.notice ?? '-'}`,
  )
  if (warm.status !== 'answered' || warm.notice) {
    console.error(
      `[live-perf] warmup 未进入正常 answered（status=${warm.status} notice=${warm.notice ?? '-'}）→ 中止采样；请先排查 live 配置`,
    )
    await cleanup()
    return 2
  }

  // ── 正式采样窗口 ──
  await resetCapture()
  const runStart = performance.now()
  const samples: Sample[] = []
  let abortReason: string | null = null
  let consecutiveFail = 0

  while (true) {
    const elapsedSec = (performance.now() - runStart) / 1000
    const needMoreN = samples.length < N
    const needMoreTime = DURATION_SEC > 0 && elapsedSec < DURATION_SEC
    if (!needMoreN && !needMoreTime) break
    if (samples.length >= MAX_N) {
      abortReason = `达到 PERF_MAX_N=${MAX_N} 硬上限（时长未跑满）`
      break
    }

    const idx = samples.length
    const attemptsBefore = llmAttempts.length
    let ok = true
    let status: string | null = null
    let riskLevel: string | null = null
    let degraded = false
    let error: string | null = null
    const t0 = performance.now()
    try {
      const res = await consult(USER, QUESTION, [DRUG])
      status = res.status
      riskLevel = res.riskLevel
      degraded = Boolean(res.notice && /降级|不可用/.test(res.notice))
    } catch (e) {
      ok = false
      error = e instanceof Error ? e.message : String(e)
    }
    const latencyMs = round1(performance.now() - t0)
    const attempts = llmAttempts.slice(attemptsBefore)
    const okAttempt = attempts.filter((a) => a.ok).at(-1) ?? null

    samples.push({
      idx,
      atSec: round1((performance.now() - runStart) / 1000),
      latencyMs,
      ok,
      status,
      riskLevel,
      degraded,
      llmCalls: attempts.length,
      llmOk: okAttempt !== null,
      llmMs: okAttempt ? round1(okAttempt.durMs) : null,
      promptTokens: null,
      completionTokens: null,
      error,
    })

    // 连续失败熔断（异常或降级都算）
    consecutiveFail = !ok || degraded ? consecutiveFail + 1 : 0
    if (consecutiveFail >= MAX_CONSEC_FAIL) {
      abortReason = `连续 ${consecutiveFail} 次失败/降级，熔断`
      break
    }
    if (latencyMs > 15_000) {
      console.warn(`[live-perf] #${idx} 慢调用 ${latencyMs}ms status=${status ?? 'error'}`)
    }
    if (idx > 0 && idx % 10 === 0) {
      const last = samples.slice(-10).map((s) => s.latencyMs)
      console.log(
        `[live-perf] #${idx} 最近10次 P50≈${percentile(last, 50)}ms P95≈${percentile(last, 95)}ms`,
      )
    }
    if (PAUSE_MS > 0) await new Promise((r) => setTimeout(r, PAUSE_MS))
  }

  // 收尾：等 usage 旁路解析完成，再按顺序回填到样本（成功的 chat 响应 → llmOk 样本）
  await Promise.allSettled(pendingParses)
  const tickets = [...usageTickets].sort((a, b) => a.atMs - b.atMs)
  let ticketIdx = 0
  let tokenMissing = 0
  for (const s of samples) {
    if (!s.llmOk) continue
    const t = tickets[ticketIdx]
    if (!t) {
      tokenMissing++
      continue
    }
    s.promptTokens = t.prompt
    s.completionTokens = t.completion
    ticketIdx++
  }

  const durationActualSec = round1((performance.now() - runStart) / 1000)
  const completed = samples.filter((s) => s.ok)
  const latencies = completed.map((s) => s.latencyMs)
  const llmDurations = samples.map((s) => s.llmMs).filter((n): n is number => n !== null)
  const exceptions = samples.filter((s) => !s.ok).length
  const degradedCount = samples.filter((s) => s.degraded).length
  const nonAnswered = samples.filter((s) => s.ok && s.status !== 'answered').length
  const failureRate = samples.length > 0 ? (exceptions + degradedCount) / samples.length : 0

  const statuses: Record<string, number> = {}
  for (const s of samples) {
    const key = s.ok ? (s.status ?? 'unknown') : 'error'
    statuses[key] = (statuses[key] ?? 0) + 1
  }

  const firstHalf =
    DURATION_SEC > 0
      ? samples.filter((s) => s.atSec < DURATION_SEC / 2)
      : samples.filter((s) => s.idx < samples.length / 2)
  const secondHalf =
    DURATION_SEC > 0
      ? samples.filter((s) => s.atSec >= DURATION_SEC / 2)
      : samples.filter((s) => s.idx >= samples.length / 2)
  const perMinuteMap = new Map<number, Sample[]>()
  for (const s of samples) {
    const minute = Math.floor(s.atSec / 60)
    const arr = perMinuteMap.get(minute) ?? []
    arr.push(s)
    perMinuteMap.set(minute, arr)
  }
  const perMinute = [...perMinuteMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minute, list]) => {
      const tokens = list.reduce((sum, s) => sum + (s.promptTokens ?? 0) + (s.completionTokens ?? 0), 0)
      const withTokens = list.filter((s) => s.promptTokens !== null).length
      return {
        minute,
        n: list.length,
        failed: list.filter((s) => !s.ok || s.degraded).length,
        p95: percentile(
          list.map((s) => s.latencyMs),
          95,
        ),
        avgTokens: withTokens > 0 ? Math.round(tokens / withTokens) : 0,
      }
    })

  const tokenTotals = tickets.reduce(
    (acc, t) => ({
      prompt: acc.prompt + t.prompt,
      completion: acc.completion + t.completion,
      total: acc.total + t.total,
      cached: acc.cached + t.cached,
      reasoning: acc.reasoning + t.reasoning,
    }),
    { prompt: 0, completion: 0, total: 0, cached: 0, reasoning: 0 },
  )
  const denominators = Math.max(1, samples.length)
  const priceReady = PRICE_INPUT_PER_M !== null && PRICE_OUTPUT_PER_M !== null
  const cost = priceReady
    ? {
        currency: 'CNY',
        inputPerMillion: PRICE_INPUT_PER_M,
        outputPerMillion: PRICE_OUTPUT_PER_M,
        input: Math.round((tokenTotals.prompt / 1_000_000) * PRICE_INPUT_PER_M * 10_000) / 10_000,
        output:
          Math.round((tokenTotals.completion / 1_000_000) * PRICE_OUTPUT_PER_M * 10_000) / 10_000,
        total:
          Math.round(
            ((tokenTotals.prompt / 1_000_000) * PRICE_INPUT_PER_M +
              (tokenTotals.completion / 1_000_000) * PRICE_OUTPUT_PER_M) *
              10_000,
          ) / 10_000,
        perConsult:
          Math.round(
            (((tokenTotals.prompt / 1_000_000) * PRICE_INPUT_PER_M +
              (tokenTotals.completion / 1_000_000) * PRICE_OUTPUT_PER_M) /
              denominators) *
              1_000_000,
          ) / 1_000_000,
      }
    : null

  const endedBy =
    abortReason !== null
      ? '中断'
      : DURATION_SEC > 0
        ? 'N 与时长双达标'
        : 'N 达标'

  const summary = {
    generatedAt: new Date().toISOString(),
    provider: process.env.CONSULT_PROVIDER || 'qwen',
    model: process.env.CONSULT_MODEL || 'qwen3.8-flash',
    question: QUESTION,
    config: {
      n: N,
      durationSec: DURATION_SEC,
      pauseMs: PAUSE_MS,
      maxN: MAX_N,
      maxConsecFail: MAX_CONSEC_FAIL,
      priceInputPerM: PRICE_INPUT_PER_M,
      priceOutputPerM: PRICE_OUTPUT_PER_M,
    },
    durationActualSec,
    n: samples.length,
    endedBy,
    aborted: abortReason,
    latencyMs: {
      n: latencies.length,
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      min: latencies.length > 0 ? Math.min(...latencies) : 0,
      max: latencies.length > 0 ? Math.max(...latencies) : 0,
      mean:
        latencies.length > 0
          ? round1(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : 0,
      slowOver15s: latencies.filter((n) => n > 15_000).length,
    },
    llmLatencyMs: {
      n: llmDurations.length,
      p50: percentile(llmDurations, 50),
      p95: percentile(llmDurations, 95),
      min: llmDurations.length > 0 ? Math.min(...llmDurations) : 0,
      max: llmDurations.length > 0 ? Math.max(...llmDurations) : 0,
    },
    failures: {
      exceptions,
      degraded: degradedCount,
      nonAnswered,
      failureRate: Math.round(failureRate * 10_000) / 10_000,
      hardFailureRate: Math.round((exceptions / denominators) * 10_000) / 10_000,
    },
    statuses,
    stability: {
      firstHalf: summarizeWindow(firstHalf),
      secondHalf: summarizeWindow(secondHalf),
      perMinute,
    },
    tokens: {
      requests: tickets.length,
      ...tokenTotals,
      avgPromptPerConsult: Math.round(tokenTotals.prompt / denominators),
      avgCompletionPerConsult: Math.round(tokenTotals.completion / denominators),
      avgTotalPerConsult: Math.round(tokenTotals.total / denominators),
      missing: tokenMissing,
    },
    cost,
    warmup: { status: warm.status, notice: warm.notice ?? null, ms: warmMs },
    httpStatuses,
    samples,
  }

  const outDir = join(repoRoot, 'data', 'm12-reports')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'consult-live-longrun.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(join(outDir, 'consult-live-longrun.md'), renderMarkdown(summary as unknown as Record<string, unknown>))
  writeFileSync(
    join(outDir, 'consult-live-perf.json'),
    `${JSON.stringify(
      {
        generatedAt: summary.generatedAt,
        provider: summary.provider,
        model: summary.model,
        n: summary.n,
        p50: summary.latencyMs.p50,
        p95: summary.latencyMs.p95,
        min: summary.latencyMs.min,
        max: summary.latencyMs.max,
        failures: exceptions,
        statuses,
        targetFullChainP95Ms: 15_000,
        longrun: {
          durationActualSec,
          degraded: degradedCount,
          failureRate,
          tokens: summary.tokens.total,
          cost: cost?.total ?? null,
        },
      },
      null,
      2,
    )}\n`,
  )

  console.log(
    `[live-perf] n=${summary.n} 时长=${durationActualSec}s P50=${summary.latencyMs.p50}ms P95=${summary.latencyMs.p95}ms P99=${summary.latencyMs.p99}ms min=${summary.latencyMs.min} max=${summary.latencyMs.max}`,
  )
  console.log(
    `[live-perf] 失败：异常 ${exceptions} / 降级 ${degradedCount} / 非 answered ${nonAnswered}（失败率 ${(failureRate * 100).toFixed(2)}%）statuses=${JSON.stringify(statuses)}`,
  )
  console.log(
    `[live-perf] token：requests=${tickets.length} prompt=${tokenTotals.prompt} completion=${tokenTotals.completion} total=${tokenTotals.total}（单次均 total=${summary.tokens.avgTotalPerConsult}）` +
      (cost ? ` 成本≈¥${cost.total}` : ' 成本：未配置单价'),
  )
  console.log(
    `[live-perf] 长稳：前半程 P95=${summary.stability.firstHalf.p95}ms / 后半程 P95=${summary.stability.secondHalf.p95}ms`,
  )
  console.log(
    `[live-perf] 目标：全链 P95 ≤ 15000ms → ${summary.latencyMs.p95 <= 15_000 ? '达标' : '未达标'}；模型 P95 ≤ 4000ms → ${summary.llmLatencyMs.p95 <= 4_000 ? '达标' : '未达标'}`,
  )

  await cleanup()
  return exceptions === 0 && degradedCount === 0 ? 0 : 1
}

main()
  .then(async (code) => {
    await client.end()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error('❌ live 长稳采样失败:', err)
    await cleanup().catch(() => undefined)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
