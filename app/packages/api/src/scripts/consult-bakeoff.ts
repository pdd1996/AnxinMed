/**
 * 咨询文本模型对打脚本（P1 · docs/13 §6）——同一套题集对打多 provider，产出 §6.2 门槛对照报告。
 *
 * 运行：cd app/packages/api && npm run eval:consult-bakeoff -- --providers=qwen-flash,qwen-plus,deepseek-flash,baichuan-m3
 *       （缺省全跑；输出建议重定向存 data/consult-bakeoff/<date>-summary.md）
 * 题集：app/fixtures/consult-bakeoff.json（P0-T4 起草，跑实测前需人工过目）。
 * 说明书段落从 dev 库 package_inserts 按 drugId 实时取，payload 经生产 pickInsertSections 组装——
 * 与 runConsult 同构；interactionsText 按题集注入（模拟规则引擎文本）或「未见已知相互作用」兜底行。
 *
 * 指标（§6.2 门槛）：schema 首过率 ≥99% / 高危加戏（strip 命中）=0 / reasoning 泄漏 =0 /
 * 空回率单列（DeepSeek 官方自认 JSON 模式偶发空回）/ 模型延迟 P50·P95（目标 ≤4s）。
 * 人工审维度（引文忠实 / 通俗质量 / 负例越权）需逐 case 看明细 JSON，不自动化断言。
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { pickInsertSections } from '../services/consult/sections.js'
import { normalizeSections } from '../services/consult/sections.js'
import type { ConsultPromptPayload } from '../lib/ai/types.js'
import type { InsertSlice } from '../services/consult/types.js'
import * as qwenText from '../lib/ai/qwen-text.js'
import * as deepseek from '../lib/ai/deepseek.js'
import * as baichuan from '../lib/ai/baichuan.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SPEC_PATH = fileURLToPath(new URL('../../../../fixtures/consult-bakeoff.json', import.meta.url))
const OUT_DIR = fileURLToPath(new URL('../../../../../data/consult-bakeoff', import.meta.url))

/** 与 run.ts renderInteractionsForPrompt 的「无命中」分支同文案。 */
const NO_INTERACTION_TEXT = '生效计划集合中未见已知相互作用（规则库覆盖有限，未覆盖不表示无风险）。'

interface BakeoffCase {
  id: string
  category: string
  question: string
  drugId: string
  sectionKey: string
  conditions?: string[]
  interactionsText?: string
}
interface BakeoffSpec {
  version: string
  date: string
  note: string
  cases: BakeoffCase[]
}

/** provider 注册表：env 覆盖 + consultAnswer 实现（顺序 = 报告列序）。 */
const PROVIDERS: Record<string, { env: Record<string, string>; run: (p: ConsultPromptPayload) => Promise<unknown> }> = {
  'qwen-flash': { env: { CONSULT_MODEL: 'qwen3.8-flash' }, run: (p) => qwenText.consultAnswer(p) },
  'qwen-plus': { env: { CONSULT_MODEL: 'qwen-plus' }, run: (p) => qwenText.consultAnswer(p) },
  'deepseek-flash': { env: { DEEPSEEK_MODEL: 'deepseek-flash' }, run: (p) => deepseek.consultAnswer(p) },
  'baichuan-m3': { env: {}, run: (p) => baichuan.consultAnswer(p) },
}

/** 失败归类（§4.3 断言链：思考泄漏 / 空 content / JSON / schema / HTTP-网络）。 */
function classifyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('思考泄漏')) return 'thinking-leak'
  if (msg.includes('缺少 content')) return 'empty-content'
  if (msg.includes('不是合法 JSON')) return 'invalid-json'
  if (msg.includes('不符合约定')) return 'schema-mismatch'
  return 'unavailable'
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

async function main(): Promise<void> {
  const spec = JSON.parse(await import('node:fs').then((m) => m.readFileSync(SPEC_PATH, 'utf-8'))) as BakeoffSpec
  const providersArg = process.argv.find((a) => a.startsWith('--providers'))
  const wanted = (providersArg?.split('=')[1] ?? Object.keys(PROVIDERS).join(',')).split(',').map((s) => s.trim())

  // 说明书行批量取（dev 库；题面药品须已在库）
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 })
  const inserts = new Map<string, InsertSlice>()
  for (const c of spec.cases) {
    if (inserts.has(c.drugId)) continue
    const rows = await sql`
      select id, drug_id as "drugId", generic_name as "genericName", brand_name as "brandName",
             specification, form, indication, components, dosage, contraindications,
             adverse_reactions as "adverseReactions", precautions, interactions, pharmacology,
             pharmacokinetics, storage, source, version
      from package_inserts where drug_id = ${c.drugId} limit 1`
    const r = rows[0]
    if (!r) throw new Error(`题集药品不在库中：${c.drugId}（先补说明书入库）`)
    inserts.set(c.drugId, {
      drugId: String(r.drugId),
      genericName: String(r.genericName),
      brandName: (r.brandName as string) ?? null,
      specification: (r.specification as string) ?? null,
      form: (r.form as string) ?? null,
      indication: (r.indication as string) ?? null,
      components: (r.components as string) ?? null,
      dosage: r.dosage as unknown,
      contraindications: r.contraindications as unknown,
      adverseReactions: (r.adverseReactions as string) ?? null,
      precautions: r.precautions as unknown,
      interactions: (r.interactions as string) ?? null,
      pharmacology: (r.pharmacology as string) ?? null,
      pharmacokinetics: (r.pharmacokinetics as string) ?? null,
      storage: (r.storage as string) ?? null,
      source: String(r.source ?? ''),
      version: (r.version as string) ?? null,
    })
  }
  await sql.end()

  const savedEnv: Record<string, string | undefined> = {}
  const summaryRows: string[] = []
  const reportDate = new Date().toISOString().slice(0, 10)
  mkdirSync(OUT_DIR, { recursive: true })

  for (const name of wanted) {
    const provider = PROVIDERS[name]
    if (!provider) throw new Error(`未知 provider：${name}（可选：${Object.keys(PROVIDERS).join(', ')}）`)
    // env 覆盖（顺序执行无并发；跑完还原）
    for (const [k, v] of Object.entries(provider.env)) {
      savedEnv[k] = process.env[k]
      process.env[k] = v
    }

    const rows: Array<Record<string, unknown>> = []
    for (const c of spec.cases) {
      const insert = inserts.get(c.drugId)!
      const section = pickInsertSections(c.question, insert)
      const payload: ConsultPromptPayload = {
        question: c.question,
        drug: {
          genericName: insert.genericName,
          brandName: insert.brandName,
          specification: insert.specification,
          form: insert.form,
          isManual: false,
        },
        section: { label: section.label, version: insert.version, text: section.text },
        interactionsText: c.interactionsText ?? NO_INTERACTION_TEXT,
        ...(c.conditions && c.conditions.length > 0 ? { conditions: c.conditions } : {}),
      }
      const t0 = Date.now()
      try {
        const raw = (await provider.run(payload)) as Record<string, unknown>
        const ms = Date.now() - t0
        const normalized = normalizeSections(raw as never, {})
        rows.push({
          id: c.id,
          category: c.category,
          question: c.question,
          pickedSection: section.key,
          ok: true,
          ms,
          stripHit: normalized.limited, // 高危加戏代理：剂量话术被 strip 命中
          emptySummary: !String(raw.summary ?? '').trim(),
          latencyClass: ms <= 4000 ? '≤4s' : ms <= 8000 ? '≤8s' : '>8s',
          raw,
        })
      } catch (e) {
        const ms = Date.now() - t0
        rows.push({
          id: c.id,
          category: c.category,
          question: c.question,
          pickedSection: section.key,
          ok: false,
          ms,
          failure: classifyError(e),
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }

    // 还原 env
    for (const [k, v] of Object.entries(provider.env)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }

    const okRows = rows.filter((r) => r.ok) as Array<Record<string, unknown> & { ms: number }>
    const latencies = okRows.map((r) => r.ms).sort((a, b) => a - b)
    const metrics = {
      provider: name,
      total: rows.length,
      schemaOk: okRows.length,
      schemaOkRate: `${((okRows.length / rows.length) * 100).toFixed(1)}%`,
      failures: rows.filter((r) => !r.ok).map((r) => `${r.id}:${r.failure}`),
      stripHit: rows.filter((r) => r.stripHit === true).map((r) => r.id),
      emptySummary: rows.filter((r) => r.emptySummary === true).map((r) => r.id),
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
    }
    writeFileSync(`${OUT_DIR}/${reportDate}-${name}.json`, JSON.stringify({ metrics, rows }, null, 2) + '\n')
    summaryRows.push(
      `| ${name} | ${metrics.schemaOk}/${metrics.total}（${metrics.schemaOkRate}） | ${metrics.stripHit.length ? metrics.stripHit.join(',') : 0} | ${metrics.emptySummary.length ? metrics.emptySummary.join(',') : 0} | ${metrics.failures.length ? metrics.failures.join(',') : 0} | ${metrics.p50Ms} | ${metrics.p95Ms} |`,
    )
    console.log(`[bakeoff] ${name} 完成：schema ${metrics.schemaOk}/${metrics.total}，P50 ${metrics.p50Ms}ms / P95 ${metrics.p95Ms}ms`)
  }

  const md = `# 咨询文本模型对打报告（${reportDate}）

> 题集：consult-bakeoff.json v${spec.version}（${spec.cases.length} 题）· 门槛：schema 首过率 ≥99% / 高危加戏 =0 / 思考泄漏 =0 / 模型 P95 ≤4s
> 高危加戏以 strip 命中为代理指标；引文忠实 / 通俗质量 / 负例越权需人工逐 case 审明细 JSON。

| provider | schema 首过 | 高危加戏(strip) | 空回 | 失败(归类) | P50 ms | P95 ms |
|---|---|---|---|---|---|---|
${summaryRows.join('\n')}

明细：同目录 <date>-<provider>.json（raw 全量，供人工审）。
`
  console.log('\n' + md)
}

main().catch((e) => {
  console.error('[bakeoff] 失败：', e)
  process.exit(1)
})
