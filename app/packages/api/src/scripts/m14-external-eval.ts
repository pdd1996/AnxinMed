/**
 * M14 外部知识兜底评估（A12/A13 裁决数据）—— 只读，不改库、不改行为。
 *
 * 两种模式（在 app/packages/api 下运行）：
 *   node --import tsx src/scripts/m14-external-eval.ts coverage
 *   node --import tsx src/scripts/m14-external-eval.ts bakeoff
 *
 * coverage：用本地 consult_logs（近 200 条）+ 人工标注样句，统计规则触发与精确率；
 * bakeoff  ：固定题库 × 百川/千问，测延迟、JSON 契约通过、安全清洗通过、拒答/空 content。
 *
 * 产物（不入库）：data/m14-reports/external-eval-<mode>-<日期>.json
 * 注意：bakeoff 会真实调用模型（约 2N 次），勿在 CI/无人值守环境跑。
 */
import '../lib/env.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as baichuan from '../lib/ai/baichuan.js'
import * as qwenText from '../lib/ai/qwen-text.js'
import {
  sanitizeExternalSections,
  shouldAnswerExternalKnowledge,
} from '../services/consult/external.js'

// ---------------------------------------------------------------- 语料

/** 人工标注样句：expected=true 应走外部兜底；false 应被排除（剂量/生活/无药品语境/无物质）。 */
const LABELED: Array<{ q: string; expected: boolean }> = [
  { q: '酒和藿香正气水能一起吃吗', expected: true },
  { q: '吃头孢能喝酒吗', expected: true },
  { q: '吃头孢类的药能喝酒吗', expected: true },
  { q: '西柚和他汀类药物能一起吃吗', expected: true },
  { q: '葡萄柚和硝苯地平能同时吃吗', expected: true },
  { q: '咖啡和药能一起喝吗', expected: true },
  { q: '喝浓茶会影响药效吗', expected: true },
  { q: '白酒和阿司匹林有冲突吗', expected: true },
  { q: '阿司匹林一次吃几片', expected: false },
  { q: '这个药一天吃几次', expected: false },
  { q: '高血压平时要注意什么', expected: false },
  { q: '喝酒后头晕怎么办', expected: false },
  { q: '这个药有什么副作用', expected: false },
  { q: '我头疼吃点什么药', expected: false },
]

/** bakeoff 题库：全部为规则应触发的「物质 × 同服」问题（去重、限定 8 题控制调用量）。 */
const BAKEOFF_QUESTIONS = [
  '酒和藿香正气水能一起吃吗',
  '吃头孢能喝酒吗',
  '西柚和他汀类药物能一起吃吗',
  '葡萄柚和硝苯地平能同时吃吗',
  '咖啡和药能一起喝吗',
  '喝浓茶会影响药效吗',
  '白酒和阿司匹林有冲突吗',
  '吃甲硝唑能喝酒吗',
]

type ExternalOutput = { sections: Parameters<typeof sanitizeExternalSections>[0]; modelLabel: string }

const MODELS: Array<{ label: string; fn: (q: string) => Promise<ExternalOutput> }> = [
  { label: 'baichuan-m3-plus', fn: (q) => baichuan.externalKnowledge(q) },
  { label: process.env.CONSULT_MODEL || 'qwen3.8-flash', fn: (q) => qwenText.externalKnowledge(q) },
]

// ---------------------------------------------------------------- 工具

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

function outDir(): string {
  const repoRoot = resolve(process.cwd(), '../../..')
  const dir = resolve(repoRoot, 'data/m14-reports')
  mkdirSync(dir, { recursive: true })
  return dir
}

function saveJson(mode: string, payload: unknown): string {
  const stamp = new Date().toISOString().slice(0, 10)
  const path = resolve(outDir(), `external-eval-${mode}-${stamp}.json`)
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
  return path
}

// ---------------------------------------------------------------- coverage

async function runCoverage(): Promise<void> {
  const { db } = await import('../db/client.js')
  const { consultLogs } = await import('../db/schema.js')
  const { desc } = await import('drizzle-orm')

  const rows = await db
    .select({ question: consultLogs.question, status: consultLogs.status })
    .from(consultLogs)
    .orderBy(desc(consultLogs.createdAt))
    .limit(200)

  const labeled = LABELED.map((row) => ({ ...row, actual: shouldAnswerExternalKnowledge(row.q) }))
  const tp = labeled.filter((r) => r.expected && r.actual).length
  const fp = labeled.filter((r) => !r.expected && r.actual).length
  const fn = labeled.filter((r) => r.expected && !r.actual).length
  const tn = labeled.filter((r) => !r.expected && !r.actual).length

  const triggered = rows.filter((r) => shouldAnswerExternalKnowledge(r.question))
  const noSource = rows.filter((r) => r.status === 'no-source')
  const noSourceTriggered = noSource.filter((r) => shouldAnswerExternalKnowledge(r.question))

  const payload = {
    generatedAt: new Date().toISOString(),
    consultLogsScanned: rows.length,
    triggeredByRule: triggered.length,
    noSourceScanned: noSource.length,
    noSourceTriggered: noSourceTriggered.length,
    samplesTriggered: triggered.slice(0, 10).map((r) => r.question),
    labeled: { tp, fp, fn, tn, precision: tp + fp ? tp / (tp + fp) : NaN, recall: tp + fn ? tp / (tp + fn) : NaN },
    labeledDetail: labeled,
  }
  const path = saveJson('coverage', payload)
  console.log('## coverage')
  console.log(`- consult_logs 扫描 ${rows.length} 条，规则命中 ${triggered.length} 条；其中 no-source ${noSource.length} 条，命中 ${noSourceTriggered.length} 条`)
  console.log(`- 人工标注 ${labeled.length} 条：TP=${tp} FP=${fp} FN=${fn} TN=${tn}，precision=${(payload.labeled.precision * 100).toFixed(1)}%，recall=${(payload.labeled.recall * 100).toFixed(1)}%`)
  if (fn > 0) console.log('- 漏召回：', labeled.filter((r) => r.expected && !r.actual).map((r) => r.q))
  if (fp > 0) console.log('- 误触发：', labeled.filter((r) => !r.expected && r.actual).map((r) => r.q))
  console.log('- JSON:', path)
}

// ---------------------------------------------------------------- bakeoff

async function runBakeoff(): Promise<void> {
  const results: Array<Record<string, unknown>> = []
  for (const model of MODELS) {
    for (const question of BAKEOFF_QUESTIONS) {
      const started = performance.now()
      let ok = false
      let sanitized: ReturnType<typeof sanitizeExternalSections> = null
      let error: string | null = null
      let sample: { summary?: string; keyPoints?: string[] } = {}
      let rawOut: unknown = null
      try {
        const output = await model.fn(question)
        const raw = output.sections
        rawOut = raw
        ok = true
        sanitized = sanitizeExternalSections(raw)
        if (raw) {
          sample = {
            summary: String((raw as { summary?: unknown } | null)?.summary ?? '').slice(0, 60),
            keyPoints: ((raw as { keyPoints?: unknown } | null)?.keyPoints as string[] | undefined)?.slice(0, 2),
            modelLabel: output.modelLabel,
          }
        }
      } catch (e) {
        error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      }
      const elapsed = performance.now() - started
      results.push({
        model: model.label,
        question,
        latencyMs: Math.round(elapsed),
        contractOk: ok,
        sanitizedOk: sanitized !== null,
        error,
        warningHasAiMark: sanitized?.warning.includes('AI 生成') ?? false,
        sample,
        raw: rawOut,
      })
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  const byModel: Record<string, Record<string, unknown>> = {}
  for (const model of MODELS) {
    const rows = results.filter((r) => r.model === model.label)
    const latencies = rows.map((r) => r.latencyMs as number).sort((a, b) => a - b)
    byModel[model.label] = {
      calls: rows.length,
      contractOk: rows.filter((r) => r.contractOk).length,
      sanitizedOk: rows.filter((r) => r.sanitizedOk).length,
      refusedOrError: rows.filter((r) => r.error).length,
      latencyP50Ms: pct(latencies, 50),
      latencyP95Ms: pct(latencies, 95),
      latencyMaxMs: latencies[latencies.length - 1] ?? null,
    }
  }
  const payload = { generatedAt: new Date().toISOString(), questions: BAKEOFF_QUESTIONS.length, byModel, results }
  const path = saveJson('bakeoff', payload)
  console.log('## bakeoff')
  for (const [model, s] of Object.entries(byModel)) {
    const m = s as Record<string, number>
    console.log(
      `- ${model}: calls=${m.calls} contractOk=${m.contractOk} sanitizedOk=${m.sanitizedOk} ` +
        `refusedOrError=${m.refusedOrError} p50=${m.latencyP50Ms}ms p95=${m.latencyP95Ms}ms max=${m.latencyMaxMs}ms`,
    )
  }
  const failed = results.filter((r) => r.error)
  if (failed.length) {
    console.log('- 失败明细：')
    for (const f of failed) console.log(`  - ${f.model} / ${f.question}: ${f.error}`)
  }
  console.log('- JSON:', path)
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'all'
  if (mode === 'coverage' || mode === 'all') await runCoverage()
  if (mode === 'bakeoff' || mode === 'all') await runBakeoff()
  if (mode !== 'coverage' && mode !== 'bakeoff' && mode !== 'all') {
    console.error('用法：node --import tsx src/scripts/m14-external-eval.ts [coverage|bakeoff|all]')
    process.exit(2)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('[m14-external-eval] 失败：', e)
  process.exit(1)
})
