/**
 * 一次性迁移（2026-09-05）—— drug 命名规则落地：mock-* → drug-* 的 6 个爬虫建档 ID 改名
 *
 * 背景：草稿 drugId 命名从 mock- 前缀改为 drug- 前缀（与数据来源解耦，见
 * data/crawled-总账.md「命名规则」），但这 6 条在改名前已由
 * db:import-crawled 以旧 ID 入库（drug_master + package_inserts）。
 * 本脚本把库内行改成与磁盘草稿一致的新 ID；幂等，可重复运行。
 *
 * 迁移范围（仅这 6 个未绑定 mock-data.json 的条目；seed 带入的 9 个 mock-* 是既有约定，不动）：
 *   drug_master.id                                   mock-X → drug-X
 *   package_inserts.drug_id                          mock-X → drug-X
 *   package_inserts.id                               pi-mock-X@… → pi-drug-X@…
 *
 * 防御：interaction_rules.drug_ids 若引用任一旧 ID 则整体中止（当前规则库只引用 seed 的 9 药，预期不触发）。
 */
import 'dotenv/config'
import { eq, inArray } from 'drizzle-orm'
import { db, client } from './client.js'
import { drugMaster, packageInserts, interactionRules } from './schema.js'

const RENAMES: readonly [oldId: string, newId: string][] = [
  ['mock-nifedipine-30', 'drug-nifedipine-30'],
  ['mock-acetaminophen-650', 'drug-acetaminophen-650'],
  ['mock-ibuprofen-300', 'drug-ibuprofen-300'],
  ['mock-compound-pseudoephedrine', 'drug-compound-pseudoephedrine'],
  ['mock-ganmaoling-999', 'drug-ganmaoling-999'],
  ['mock-lianhua-qingwen', 'drug-lianhua-qingwen'],
]

async function main(): Promise<number> {
  const oldIds = RENAMES.map(([o]) => o)

  // 防御：规则库不得引用旧 ID（改名会留下悬空引用）
  const rules = await db.select().from(interactionRules)
  const offenders = rules.filter((r) => {
    const ids = (r.drugIds as string[]) ?? []
    return ids.some((id) => oldIds.includes(id))
  })
  if (offenders.length > 0) {
    console.error(`❌ interaction_rules 有 ${offenders.length} 条引用旧 ID（${offenders.map((r) => r.id).join(', ')}），中止。请先人工处理规则条目。`)
    return 1
  }

  let migrated = 0
  let already = 0

  for (const [oldId, newId] of RENAMES) {
    const oldMaster = await db.select().from(drugMaster).where(eq(drugMaster.id, oldId))
    const newMaster = await db.select().from(drugMaster).where(eq(drugMaster.id, newId))

    if (oldMaster.length === 0 && newMaster.length === 0) {
      console.log(`  ${oldId} → ${newId}  ⚠️ 两边都不存在（未导入过？跳过）`)
      continue
    }
    if (oldMaster.length > 0 && newMaster.length > 0) {
      console.error(`  ${oldId} → ${newId}  ❌ 新旧两行并存，状态异常，中止本条（人工核查）`)
      return 1
    }
    if (oldMaster.length === 0 && newMaster.length > 0) {
      already++
      console.log(`  ${oldId} → ${newId}  ✓ 已迁移（幂等跳过）`)
      continue
    }

    await db.transaction(async (tx) => {
      const inserts = await tx.select().from(packageInserts).where(eq(packageInserts.drugId, oldId))
      for (const row of inserts) {
        const newInsertId = row.id.replace(`pi-${oldId}`, `pi-${newId}`)
        await tx
          .update(packageInserts)
          .set({ id: newInsertId, drugId: newId, updatedAt: new Date() })
          .where(eq(packageInserts.id, row.id))
      }
      await tx.update(drugMaster).set({ id: newId, updatedAt: new Date() }).where(eq(drugMaster.id, oldId))
    })
    migrated++
    console.log(`  ${oldId} → ${newId}  ✓ 迁移完成`)
  }

  const masters = await db.select({ id: drugMaster.id }).from(drugMaster)
  const inserts = await db.select({ id: packageInserts.id, drugId: packageInserts.drugId }).from(packageInserts)
  const dangling = inserts.filter((r) => !masters.some((m) => m.id === r.drugId))
  console.log(`\n${'✅'/* 迁移完成 */} 迁移 ${migrated} 条，幂等跳过 ${already} 条；现存 drug_master ${masters.length} 行 / package_inserts ${inserts.length} 行`)
  if (dangling.length > 0) {
    console.error(`❌ 发现 ${dangling.length} 行 package_inserts.drugId 悬空：${dangling.map((r) => r.id).join(', ')}`)
    return 1
  }
  console.log('   悬空引用检查：通过')
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 迁移失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
