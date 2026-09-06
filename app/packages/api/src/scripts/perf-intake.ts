/**
 * M3-T5 性能测量工具（spec §T5.1）——「上传→草稿」P50/P95 采样。
 *
 * 以**瞬时 mock 模型**跑真实 intake 编排 N 次，测 gatherContext(DB 读) + 管线编排 + persist(DB 写)
 * 的**非模型开销** P50/P95。模型延迟（OCR/VLM/LLM，主导项）无法在本机无 live 服务时实测，
 * 见 docs/09 报告：OCR 引 tools/ocr-bench 实测（Windows CPU 69s，PIR/oneDNN bug）+ ADR#13 生产预期（Linux 1–3s）。
 *
 * 自清理：只删除本次运行创建的草稿，不触碰其它数据。运行：cd app/packages/api && npm run perf:intake
 * 可调：PERF_N（次数，默认 30）、PERF_USER（默认 p-001，dev 库已 seed 的演示用户）。
 */
import 'dotenv/config'
import { inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { drafts } from '../db/schema.js'
import { intakePrescription } from '../services/intake.service.js'
import { Stopwatch, aggregateTimings, type TimingSummary } from '../lib/timing.js'
import { mockClients, mkOcr, IMG } from '../__tests__/helpers/ai-mocks.js'

const USER = process.env.PERF_USER ?? 'p-001'
const N = Number(process.env.PERF_N ?? 30)

const HEADER = [
  '萧山区第二人民医院（演示合成处方笺）',
  '处方号：RX20260902001',
  '日期：2026-09-02  科室：眼科',
  '临床诊断：干眼综合征',
]
const RX = [...HEADER, 'Rp', '玻璃酸钠滴眼液 0.1%（10mL：10mg） ×1支', '用法：滴眼 每次1滴 每日4次 共7天', '处方完毕']
const IDENTITY = { genericName: '玻璃酸钠滴眼液', brandName: '海露', specification: '0.1%（10mL：10mg）', form: '滴眼液' }

async function main(): Promise<void> {
  const clients = mockClients({ layers: ['处方层'], ocr: mkOcr(RX), identity: IDENTITY })
  const samples: TimingSummary[] = []
  const createdDraftIds: string[] = []

  console.log(`[perf] 跑 ${N} 次 POST /api/intake/prescription（瞬时 mock 模型 → 测非模型开销）…`)
  // 预热 1 次（连接池/ JIT），不计入样本
  const warm = await intakePrescription(USER, IMG, clients, new Stopwatch())
  createdDraftIds.push(...warm.draftIds)

  for (let i = 0; i < N; i += 1) {
    const sw = new Stopwatch()
    const res = await intakePrescription(USER, IMG, clients, sw)
    samples.push(sw.summarize())
    createdDraftIds.push(...res.draftIds)
  }

  const agg = aggregateTimings(samples)
  const totals = samples.map((s) => s.totalMs).sort((a, b) => a - b)
  console.log('\n[perf] ===== 上传→草稿 · 非模型开销（ms）=====')
  console.log(`[perf] 样本数 N=${agg.count}`)
  console.log(`[perf] total   P50=${agg.total.p50}  P95=${agg.total.p95}  min=${totals[0]}  max=${totals[totals.length - 1]}`)
  for (const [name, v] of Object.entries(agg.phases)) {
    console.log(`[perf]   ${name.padEnd(14)} P50=${String(v.p50).padStart(6)}  P95=${String(v.p95).padStart(6)}`)
  }
  console.log(`\n[perf] 说明：以上为「非模型开销」（DB 读/编排/DB 写）。真实 P95 = 本开销 + 模型延迟（主导，需 live 服务实测）。`)
  console.log(`[perf] 单次 P95 参考：total P95=${agg.total.p95}ms；模型侧 OCR 见 ocr-bench（Win CPU ~69s / Linux 预期 1–3s）。`)

  // 自清理：删除本次创建的草稿
  if (createdDraftIds.length > 0) {
    await db.delete(drafts).where(inArray(drafts.id, createdDraftIds))
    console.log(`[perf] 已清理 ${createdDraftIds.length} 份草稿（含预热）`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[perf] 失败：', err)
    process.exit(1)
  })
