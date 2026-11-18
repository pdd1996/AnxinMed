/**
 * 小模型意图分类离线评测（P3 · docs/14 §4 T8）——**只做离线对照，不接线上**。
 *
 * 做法：
 * - 取 `app/fixtures/consult-intent-eval.json` 中自由文本路由用例（期望 S1 或 S2/*，共 96 条）；
 * - 用 qwen3.8-flash / deepseek-flash **非思考 + temperature=0 + JSON 输出**分类到
 *   {S1, medication-list, adherence, expiry-stock, interaction-check, next-dose}；
 * - 输出 zod 校验；与「规则路由基线（resolveSkillRoute）」逐条对比，统计混淆矩阵、
 *   危险方向（期望 S1 却判 S2）与安全漏判（期望 S2 却判 S1）、延迟 P50/P95；
 * - 结果落 `app/backups/intent-classifier/`（gitignored），供 docs/specs/21 引用。
 *
 * 纪律：本脚本不修改任何路由/线上行为；不记录 API Key；不写业务库。
 *
 * 运行：
 *   cd app/packages/api
 *   pnpm exec tsx src/scripts/eval-consult-intent-classifier.ts
 *   可选：--providers=qwen,deepseek --limit=10 --refresh --concurrency=4
 */
import '../lib/env.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { callJson, extractChatContentStrict, parseModelJson, type ChatResponse } from '../lib/ai/http.js'
import { IntentEvalFileSchema, type IntentEvalCase } from '../services/consult/intent-eval.js'
import { isRouteNormalizeEnabled } from '../services/consult/normalize.js'
import { formatSkillRoute, resolveSkillRoute } from '../services/consult/registry.js'

const FIXTURE_PATH = fileURLToPath(new URL('../../../../fixtures/consult-intent-eval.json', import.meta.url))
const OUT_DIR = fileURLToPath(new URL('../../../../../app/backups/intent-classifier', import.meta.url))

const CLASSIFY_INTENTS = [
  'S1',
  'medication-list',
  'adherence',
  'expiry-stock',
  'interaction-check',
  'next-dose',
] as const
type ClassifyIntent = (typeof CLASSIFY_INTENTS)[number]

const PredictionSchema = z.object({ intent: z.enum(CLASSIFY_INTENTS) })

const SYSTEM_PROMPT = `你是「安心用药」医疗助手的意图路由器。只根据患者问题判断应走哪条路由，只输出 JSON：{"intent":"..."}。
可选 intent（严格三选一）：
- "S1"：需要查说明书/解释药品资料的用药问题（适应症、用法用量、禁忌、不良反应、注意事项、储存等）；拿不准时一律选 S1。
- "medication-list"：问药箱里有哪些药 / 有多少种药 / 正在吃哪些药。
- "adherence"：问近期依从性、漏服、是否按时吃药、执行率。
- "expiry-stock"：问药品是否过期/临期、还剩多少、库存、是否快用完。
- "interaction-check"：问多种药一起吃是否有冲突/相互作用/风险。
- "next-dose"：问今天该吃哪些药、今日待服安排、几点吃。
规则：
1) 宁可漏判走 S1（安全），不要为了模板而误判；
2) 只有问题明确属于某个数据查询意图才选对应 intent；
3) 禁止输出 JSON 以外的任何文字。`

interface Provider {
  id: 'qwen' | 'deepseek'
  label: string
  model: string
  /** 单条分类；失败抛错（由调用方计错）。 */
  classify: (question: string) => Promise<ClassifyIntent>
}

function qwenProvider(): Provider {
  return {
    id: 'qwen',
    label: 'qwen3.8-flash（非思考）',
    model: process.env.QWEN_CLASSIFY_MODEL || 'qwen3.8-flash',
    async classify(question) {
      const baseUrl = process.env.QWEN_BASE_URL
      const key = process.env.QWEN_API_KEY
      if (!baseUrl || !key) throw new Error('缺少 QWEN_BASE_URL / QWEN_API_KEY')
      const res = await callJson<ChatResponse>(
        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: process.env.QWEN_CLASSIFY_MODEL || 'qwen3.8-flash',
            temperature: 0,
            response_format: { type: 'json_object' },
            // R4 非思考：与 qwen-text 线上配置同款
            enable_thinking: false,
            preserve_thinking: false,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `患者问题：「${question}」` },
            ],
          }),
        },
        { client: 'qwen-text', timeoutMs: 20_000, retries: 2 },
      )
      const raw = parseModelJson(extractChatContentStrict(res, 'qwen-text'), 'qwen-text')
      const parsed = PredictionSchema.safeParse(raw)
      if (!parsed.success) throw new Error(`输出不符合约定：${parsed.error.message}`)
      return parsed.data.intent
    },
  }
}

function deepseekProvider(): Provider {
  return {
    id: 'deepseek',
    label: 'deepseek-flash（非思考）',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    async classify(question) {
      const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
      const key = process.env.DEEPSEEK_API_KEY
      if (!key) throw new Error('缺少 DEEPSEEK_API_KEY')
      const res = await callJson<ChatResponse>(
        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
            temperature: 0,
            // R4 非思考：与 deepseek 线上配置同款
            thinking: { type: 'disabled' },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `患者问题：「${question}」` },
            ],
          }),
        },
        { client: 'deepseek', timeoutMs: 20_000, retries: 2 },
      )
      const raw = parseModelJson(extractChatContentStrict(res, 'deepseek'), 'deepseek')
      const parsed = PredictionSchema.safeParse(raw)
      if (!parsed.success) throw new Error(`输出不符合约定：${parsed.error.message}`)
      return parsed.data.intent
    },
  }
}

interface CasePrediction {
  intent: ClassifyIntent
  latencyMs: number
}

interface CacheFile {
  provider: string
  model: string
  updatedAt: string
  predictions: Record<string, CasePrediction>
}

function readCache(providerId: string): CacheFile | null {
  const file = `${OUT_DIR}/cache-${providerId}.json`
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as CacheFile
  } catch {
    return null
  }
}

function writeCache(cache: CacheFile): void {
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(`${OUT_DIR}/cache-${cache.provider}.json`, JSON.stringify(cache, null, 2), 'utf8')
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

/** 并发受限的 map（离线评测用；不做重试——provider 内部 callJson 已重试）。 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

interface RouteMetrics {
  expected: string
  total: number
  correct: number
}

interface ProviderReport {
  provider: string
  model: string
  total: number
  success: number
  correct: number
  errors: number
  errorSamples: string[]
  accuracy: number
  byRoute: RouteMetrics[]
  confusion: Record<string, Record<string, number>>
  dangerous: number
  safeMiss: number
  latencyP50: number
  latencyP95: number
  ruleBaselineAccuracy: number
  disagreements: { id: string; question: string; expected: string; predicted: string }[]
}

function routeOf(intent: ClassifyIntent): string {
  return intent === 'S1' ? 'S1' : `S2/${intent}`
}

function expectedRouteOf(c: IntentEvalCase): string {
  return c.expectedRoute
}

async function evaluateProvider(
  provider: Provider,
  cases: IntentEvalCase[],
  opts: { refresh: boolean; concurrency: number },
): Promise<ProviderReport> {
  const cache = opts.refresh ? null : readCache(provider.id)
  const predictions: Record<string, CasePrediction> =
    cache && cache.model === provider.model ? { ...cache.predictions } : {}
  const pending = cases.filter((c) => !predictions[c.id])

  const errors: string[] = []
  const errorSamples: string[] = []
  if (pending.length > 0) {
    const fresh = await mapLimit(pending, opts.concurrency, async (c) => {
      const started = Date.now()
      try {
        const intent = await provider.classify(c.question)
        return { id: c.id, ok: true as const, intent, latencyMs: Date.now() - started }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (errorSamples.length < 5) errorSamples.push(`${c.id}: ${message}`)
        return { id: c.id, ok: false as const, latencyMs: Date.now() - started }
      }
    })
    for (const r of fresh) {
      if (r.ok) predictions[r.id] = { intent: r.intent, latencyMs: r.latencyMs }
    }
    writeCache({ provider: provider.id, model: provider.model, updatedAt: new Date().toISOString(), predictions })
  }

  const byRouteMap = new Map<string, RouteMetrics>()
  const confusion: Record<string, Record<string, number>> = {}
  const disagreements: ProviderReport['disagreements'] = []
  const latencies: number[] = []
  let success = 0
  let correct = 0
  let dangerous = 0
  let safeMiss = 0
  let ruleCorrect = 0

  for (const c of cases) {
    const expected = expectedRouteOf(c)
    const rule = formatSkillRoute(
      resolveSkillRoute({ question: c.question, intentRouteEnabled: true, skillId: null }).decision,
    )
    if (rule === expected) ruleCorrect += 1

    const pred = predictions[c.id]
    const bucket = byRouteMap.get(expected) ?? { expected, total: 0, correct: 0 }
    bucket.total += 1
    if (!pred) {
      errors.push(c.id)
      byRouteMap.set(expected, bucket)
      continue
    }
    success += 1
    latencies.push(pred.latencyMs)
    const predicted = routeOf(pred.intent)
    const row = (confusion[predicted] ??= {})
    row[expected] = (row[expected] ?? 0) + 1
    if (predicted === expected) {
      bucket.correct += 1
      correct += 1
    }
    else {
      disagreements.push({ id: c.id, question: c.question, expected, predicted })
      if (expected === 'S1' && predicted.startsWith('S2/')) dangerous += 1
      if (expected.startsWith('S2/') && predicted === 'S1') safeMiss += 1
    }
    byRouteMap.set(expected, bucket)
  }

  const sorted = [...latencies].sort((a, b) => a - b)
  return {
    provider: provider.id,
    model: provider.model,
    total: cases.length,
    success,
    correct,
    errors: errors.length,
    errorSamples,
    accuracy: cases.length === 0 ? 0 : correct / cases.length,
    byRoute: [...byRouteMap.values()].sort((a, b) => a.expected.localeCompare(b.expected)),
    confusion,
    dangerous,
    safeMiss,
    latencyP50: percentile(sorted, 50),
    latencyP95: percentile(sorted, 95),
    ruleBaselineAccuracy: cases.length === 0 ? 0 : ruleCorrect / cases.length,
    disagreements,
  }
}

function renderMarkdown(report: ProviderReport, date: string): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  const byRoute = report.byRoute
    .map((b) => `| ${b.expected} | ${b.correct}/${b.total} | ${b.total ? pct(b.correct / b.total) : '—'} |`)
    .join('\n')
  const confusion = Object.keys(report.confusion)
    .sort()
    .map((predicted) => {
      const row = report.confusion[predicted]
      const cells = Object.keys(row)
        .sort()
        .map((expected) => `${expected}×${row[expected]}`)
      return `| ${predicted} | ${cells.join('，')} |`
    })
    .join('\n')
  const disagreements = report.disagreements
    .slice(0, 20)
    .map((d) => `| ${d.id} | ${d.question} | ${d.expected} | ${d.predicted} |`)
    .join('\n')

  return `# 小模型意图分类离线评测 · ${report.provider}（${report.model}）

- 日期：${date}
- 语料：consult-intent-eval.json 中自由文本路由用例（S1 / S2*）${report.total} 条
- 成功率：${report.success}/${report.total}（错误 ${report.errors}）
- 准确率：**${pct(report.accuracy)}**；规则基线：${pct(report.ruleBaselineAccuracy)}
- 危险方向（期望 S1 却判 S2）：**${report.dangerous}**；安全漏判（期望 S2 却判 S1）：${report.safeMiss}
- 延迟：P50 ${report.latencyP50}ms / P95 ${report.latencyP95}ms

## 按期望路由

| 期望 | 正确/总数 | 准确率 |
|---|---|---|
${byRoute}

## 混淆矩阵（行=模型预测，列=期望）

| 预测 \\ 期望 | 明细 |
|---|---|
${confusion}

## 不一致样本（前 20）

| id | 问题 | 期望 | 预测 |
|---|---|---|---|
${disagreements}

${report.errorSamples.length > 0 ? `## 错误样本\n\n${report.errorSamples.map((e) => `- ${e}`).join('\n')}\n` : ''}
`
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const argValue = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`${name}=`))
    return hit?.split('=').slice(1).join('=')
  }
  const refresh = argv.includes('--refresh')
  const limit = Number(argValue('--limit') ?? '0') || 0
  const concurrency = Number(argValue('--concurrency') ?? '4') || 4

  const cases = IntentEvalFileSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))) as IntentEvalCase[]
  const routingCases = cases.filter(
    (c) => !c.pendingUntil && (c.expectedRoute === 'S1' || c.expectedRoute.startsWith('S2/')),
  )
  const selected = limit > 0 ? routingCases.slice(0, limit) : routingCases

  const providers: Provider[] = []
  const wanted = (argValue('--providers') ?? 'qwen,deepseek')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (wanted.includes('qwen')) providers.push(qwenProvider())
  if (wanted.includes('deepseek')) providers.push(deepseekProvider())

  console.log(`[classifier] 语料 ${selected.length} 条；归一化=${isRouteNormalizeEnabled() ? '开' : '关'}；provider=${providers.map((p) => p.id).join(',')}`)

  mkdirSync(OUT_DIR, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  const reports: ProviderReport[] = []
  for (const provider of providers) {
    console.log(`[classifier] 评测 ${provider.label}（model=${provider.model}）...`)
    const report = await evaluateProvider(provider, selected, { refresh, concurrency })
    reports.push(report)
    const suffix = `${date}-${provider.id}`
    writeFileSync(`${OUT_DIR}/report-${suffix}.json`, JSON.stringify(report, null, 2), 'utf8')
    writeFileSync(`${OUT_DIR}/report-${suffix}.md`, renderMarkdown(report, date), 'utf8')
    console.log(
      `[classifier] ${provider.id}: 准确率 ${(report.accuracy * 100).toFixed(1)}%` +
        `（规则基线 ${(report.ruleBaselineAccuracy * 100).toFixed(1)}%）；` +
        `危险 ${report.dangerous}；安全漏判 ${report.safeMiss}；错误 ${report.errors}；` +
        `P50 ${report.latencyP50}ms / P95 ${report.latencyP95}ms`,
    )
  }

  console.log(`[classifier] 报告目录：${OUT_DIR}`)
}

main().catch((e) => {
  console.error('[classifier] 运行失败：', e)
  process.exit(1)
})
