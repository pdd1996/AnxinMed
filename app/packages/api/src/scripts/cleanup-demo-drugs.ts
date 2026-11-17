/**
 * M9-T1 · demo 药箱重复行清理（p-001 海露 4 行 → 保留在用 1 行，删 3 条无引用重复）。
 *
 * 安全约束（见 services/review/demo-drug-cleanup）：
 * - 任一引用（plan / risk_event / draft payload）的行永不删；
 * - 至少保留 1 行；默认 dry-run，`--apply` 单事务；
 * - 只动指定 (--user, --master) 分组，不跨用户/跨药。
 *
 * 用法（cd app）：
 *   pnpm --filter @anxin/api db:cleanup-demo-drugs -- --dry-run
 *   pnpm --filter @anxin/api db:cleanup-demo-drugs -- --apply
 */
import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, inArray } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import { drugs, plans, riskEvents, drafts } from '../db/schema.js'
import { planDemoDrugCleanup, type DemoDrugRefs } from '../services/review/demo-drug-cleanup.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function main(): Promise<number> {
  const userId = arg('--user') ?? 'p-001'
  const masterId = arg('--master') ?? 'drug-hycosan-01'
  const apply = process.argv.includes('--apply')
  const outDir = join(repoRoot, 'data', 'm9-reports')

  const rows = await db
    .select({
      id: drugs.id,
      userId: drugs.userId,
      drugMasterId: drugs.drugMasterId,
      genericName: drugs.genericName,
      brandName: drugs.brandName,
      confirmStatus: drugs.confirmStatus,
      createdAt: drugs.createdAt,
    })
    .from(drugs)
    .where(eq(drugs.userId, userId))

  const target = rows.filter((r) => r.userId === userId && r.drugMasterId === masterId)
  if (target.length === 0) {
    console.error(`❌ ${userId} 下没有 drug_master_id=${masterId} 的 drugs 行`)
    return 1
  }

  const ids = target.map((r) => r.id)
  const [planRows, riskRows, draftRows] = await Promise.all([
    db.select({ drugId: plans.drugId }).from(plans).where(inArray(plans.drugId, ids)),
    db.select({ drugId: riskEvents.drugId }).from(riskEvents).where(inArray(riskEvents.drugId, ids)),
    db.select({ id: drafts.id, payload: drafts.payload }).from(drafts),
  ])
  const planCount = new Map<string, number>()
  for (const r of planRows) planCount.set(r.drugId, (planCount.get(r.drugId) ?? 0) + 1)
  const riskCount = new Map<string, number>()
  for (const r of riskRows) if (r.drugId) riskCount.set(r.drugId, (riskCount.get(r.drugId) ?? 0) + 1)

  const refs: Record<string, DemoDrugRefs> = {}
  for (const id of ids) {
    const draftRefs = draftRows.filter((d) => JSON.stringify(d.payload ?? {}).includes(id)).length
    refs[id] = { planRefs: planCount.get(id) ?? 0, riskEventRefs: riskCount.get(id) ?? 0, draftRefs }
  }

  const cleanupPlan = planDemoDrugCleanup(
    target.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    refs,
  )

  console.log(`\n📦 ${userId} / ${masterId}：${target.length} 行`)
  for (const r of target) {
    const used = cleanupPlan.deletes.includes(r.id) ? '🗑 删除' : '✅ 保留'
    console.log(`  ${used} ${r.id}  ${r.confirmStatus.padEnd(12)} refs=${JSON.stringify(refs[r.id])}  ${cleanupPlan.keepReasons[r.id] ?? ''}`)
  }
  for (const e of cleanupPlan.errors) console.error(`❌ ${e}`)
  if (cleanupPlan.errors.length > 0) return 1

  const report = {
    generatedAt: new Date().toISOString(),
    userId,
    masterId,
    rows: target.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    refs,
    deletes: cleanupPlan.deletes,
    keeps: cleanupPlan.keeps,
    keepReasons: cleanupPlan.keepReasons,
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'cleanup-demo-drugs.json'), `${JSON.stringify(report, null, 2)}\n`)

  if (!apply) {
    console.log('\n🔍 dry-run 结束，未落库（加 --apply 执行）')
    return 0
  }
  if (cleanupPlan.deletes.length === 0) {
    console.log('\n✅ 无需清理（已是干净状态）')
    return 0
  }

  await db.transaction(async (tx) => {
    await tx.delete(drugs).where(inArray(drugs.id, cleanupPlan.deletes))
  })
  console.log(`\n✅ 已删除 ${cleanupPlan.deletes.length} 行（单事务）：${cleanupPlan.deletes.join(', ')}`)
  console.log(`   保留：${cleanupPlan.keeps.join(', ')}`)
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 清理失败（事务已回滚）:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
