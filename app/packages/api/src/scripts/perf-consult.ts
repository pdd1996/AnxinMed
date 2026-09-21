/**
 * M4-T8 咨询骨架性能基准（specs/04-T8 完成标准 · 对齐 docs/11 §2 口径）——
 * 「守门 + 取数 + 归一化 + 留痕」服务端开销 P50/P95（**不含 LLM**：模型以瞬时 mock 替身）。
 *
 * 与 perf-intake 同款纪律：真实 consult() 全链路（含会话/建议卡/覆盖层），只冻结模型 I/O；
 * 目标值：骨架 P95 ≤ 500ms（裁决 #5）。运行：cd app/packages/api && npm run perf:consult
 * 可调：PERF_N（次数，默认 50）。自清理：只删本次创建的会话/留痕/临时资产。
 */
import 'dotenv/config'
import { inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { consultLogs, consultSessions, consultSuggestions, drugMaster, drugs, packageInserts, plans, riskEvents } from '../db/schema.js'
import { consult } from '../services/consult.service.js'
import { setAiClients } from '../lib/ai/registry.js'
import type { AiClients, ConsultPromptPayload } from '../lib/ai/types.js'
import { mockClients } from '../__tests__/helpers/ai-mocks.js'
import { aggregateTimings, type TimingSummary } from '../lib/timing.js'

const N = Number(process.env.PERF_N ?? 50)
const DM = 'dm-perf-consult'
const PI = 'pi-perf-consult'
const DRUG = 'drug-perf-consult'
const QUESTION = '这个药通常用于什么？'

/** 瞬时 mock 模型（固定输出；骨架口径 = 非 LLM 开销）。 */
const mockAi: AiClients = {
  ...mockClients({ consult: { summary: '玻璃酸钠滴眼液用于缓解干眼症状。', keyPoints: [], risks: [], nextAction: '如症状持续请咨询医生。', warning: '提示' } }),
  async consultAnswer(_p: ConsultPromptPayload) {
    return { summary: '玻璃酸钠滴眼液用于缓解干眼症状。', keyPoints: [], risks: [], nextAction: '如症状持续请咨询医生。', warning: '提示' }
  },
}

async function main() {
  // 临时资产（幂等）：一支 ocr_matched 药 + 说明书（走 S1 proceed 全链）
  await db
    .insert(drugMaster)
    .values({ id: DM, genericName: '玻璃酸钠滴眼液', specification: '0.1%（10mL:10mg）', form: '滴眼液' })
    .onConflictDoNothing()
  await db
    .insert(packageInserts)
    .values({
      id: PI,
      drugId: DM,
      genericName: '玻璃酸钠滴眼液',
      specification: '0.1%（10mL:10mg）',
      form: '滴眼液',
      indication: '用于缓解干眼症状',
      contraindications: ['对玻璃酸钠过敏者禁用'],
      adverseReactions: '偶见眼部刺激感',
      source: 'perf 演示',
      version: 'perf',
    })
    .onConflictDoNothing()
  await db
    .insert(drugs)
    .values({
      id: DRUG,
      userId: 'p-001',
      genericName: '玻璃酸钠滴眼液',
      specification: '0.1%',
      form: '滴眼液',
      drugMasterId: DM,
      confirmStatus: 'ocr_matched',
    })
    .onConflictDoNothing()

  const prev = setAiClients(mockAi)
  const samples: TimingSummary[] = []
  const sessionIds: string[] = []
  const logIds: string[] = []
  try {
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      const res = await consult('p-001', QUESTION, [DRUG])
      const ms = performance.now() - t0
      samples.push({ totalMs: ms, phases: {} })
      sessionIds.push(res.sessionId)
      logIds.push(res.consultLogId)
    }
  } finally {
    setAiClients(prev)
  }

  const agg = aggregateTimings(samples)
  const totals = samples.map((s) => s.totalMs).sort((a, b) => a - b)
  console.log('\n[perf] ===== 咨询骨架 · 守门+取数+归一化+留痕（不含 LLM，ms）=====')
  console.log(`[perf] 样本数 N=${agg.count}`)
  console.log(`[perf] total   P50=${agg.total.p50}  P95=${agg.total.p95}  min=${totals[0]}  max=${totals[totals.length - 1]}`)
  console.log(`[perf] 目标：骨架 P95 ≤ 500ms（specs/04 裁决 #5）`)
  console.log(`[perf] 说明：模型为瞬时 mock；真实全链 P95 = 本开销 + 模型延迟（主导项，live 实测 T10 收口）。`)

  // 自清理：只删本次产生的会话/留痕/建议卡 + 临时资产
  if (sessionIds.length > 0) {
    await db.delete(consultSuggestions).where(inArray(consultSuggestions.sessionId, sessionIds))
    await db.delete(consultLogs).where(inArray(consultLogs.sessionId, sessionIds))
    await db.delete(consultSessions).where(inArray(consultSessions.id, sessionIds))
  }
  if (logIds.length > 0) {
    await db.delete(riskEvents).where(inArray(riskEvents.consultLogId, logIds))
  }
  await db.delete(drugs).where(inArray(drugs.id, [DRUG]))
  await db.delete(packageInserts).where(inArray(packageInserts.id, [PI]))
  await db.delete(drugMaster).where(inArray(drugMaster.id, [DM]))
  // 兜底：drugMaster/plans 若与其他 perf 残留冲突无碍——plans 表未触碰
  void plans
  console.log(`[perf] 已清理 ${sessionIds.length} 条会话留痕与临时资产`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[perf] 失败：', err)
    process.exit(1)
  })
