/**
 * M12 · Live 全链性能采样（真实 Qwen 咨询，N 次，含 DB 读写/守门/留痕）。
 *
 * 与 perf:consult（模型瞬时 mock、只测骨架）互补：本脚本跑真实模型，产出端到端 P50/P95。
 * 临时用户 p-live-perf + 一条 reviewed 说明书 + 一条 active 计划；采样后清理，不留业务数据。
 *
 * 运行：pnpm --filter @anxin/api perf:consult-live
 *      PERF_N=20（默认）· 结果写 data/m12-reports/consult-live-perf.json（本地，gitignored）
 */
import '../lib/env.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import { consultLogs, consultSessions, drugs, plans, riskEvents, users } from '../db/schema.js'
import { consult } from '../services/consult.service.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')

const USER = 'p-live-perf'
const DRUG = 'live-drug-perf'
const PLAN = 'live-plan-perf'
const MASTER = 'drug-ruishufatatinggai-pian-5mg-h20180007'
const QUESTION = '吃瑞舒伐他汀钙片期间要注意什么？'
const N = Number(process.env.PERF_N ?? 20)

async function cleanup(): Promise<void> {
  await db.delete(consultLogs).where(eq(consultLogs.userId, USER))
  await db.delete(consultSessions).where(eq(consultSessions.userId, USER))
  await db.delete(riskEvents).where(eq(riskEvents.userId, USER))
  await db.delete(plans).where(eq(plans.userId, USER))
  await db.delete(drugs).where(eq(drugs.userId, USER))
  await db.delete(users).where(eq(users.id, USER))
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

  const warm = await consult(USER, QUESTION, [DRUG])
  console.log(`[live-perf] warmup status=${warm.status} notice=${warm.notice ?? '-'}`)

  const times: number[] = []
  const statuses: Record<string, number> = {}
  let failures = 0
  for (let i = 0; i < N; i++) {
    const t0 = Date.now()
    const res = await consult(USER, QUESTION, [DRUG])
    const ms = Date.now() - t0
    times.push(ms)
    statuses[res.status] = (statuses[res.status] ?? 0) + 1
    if (res.status !== 'answered') failures++
  }
  times.sort((a, b) => a - b)
  const pct = (p: number) => times[Math.min(times.length - 1, Math.ceil((p / 100) * times.length) - 1)] ?? 0
  const result = {
    generatedAt: new Date().toISOString(),
    provider: process.env.CONSULT_PROVIDER ?? 'default',
    model: process.env.CONSULT_MODEL || 'qwen3.8-flash',
    n: times.length,
    p50: pct(50),
    p95: pct(95),
    min: times[0] ?? 0,
    max: times.at(-1) ?? 0,
    failures,
    statuses,
    targetFullChainP95Ms: 15000,
  }
  const outDir = join(repoRoot, 'data', 'm12-reports')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'consult-live-perf.json'), `${JSON.stringify(result, null, 2)}\n`)

  console.log(
    `[live-perf] n=${result.n} P50=${result.p50}ms P95=${result.p95}ms min=${result.min}ms max=${result.max}ms failures=${failures} statuses=${JSON.stringify(statuses)}`,
  )
  console.log(`[live-perf] 目标：全链 P95 ≤ ${result.targetFullChainP95Ms}ms → ${result.p95 <= result.targetFullChainP95Ms ? '达标' : '未达标'}`)
  await cleanup()
  return failures === 0 ? 0 : 1
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ live 全链采样失败:', err)
    await cleanup().catch(() => undefined)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
