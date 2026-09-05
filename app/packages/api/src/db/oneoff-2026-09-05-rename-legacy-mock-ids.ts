/**
 * 一次性迁移（2026-09-05，第二批）—— 命名规则全量落地：剩余 9 个 mock-* 条目 → drug-*
 *
 * 背景：drugId 命名统一为 drug- 前缀（见 data/crawled-总账.md「命名规则」）。
 * 第一批（oneoff-2026-09-05-rename-drug-ids.ts）迁移了 6 条演示备用条目；本脚本处理剩余
 * 9 条原 mock 清单条目——它们同时存在于 demo/server/mock-data.json（已同步改 ID）与数据库。
 *
 * 迁移范围：
 *   drug_master.id                mock-X → drug-X
 *   package_inserts.drug_id / id  mock-X → drug-X（含 seed 的无版本行 pi-mock-X 与导入的带版本行 pi-mock-X@ver）
 *   interaction_rules.drug_ids    数组内元素 mock-X → drug-X（本批 3 条规则引用这些 ID，必须改写）
 *
 * 幂等，可重复运行。
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db, client } from './client.js'
import { drugMaster, packageInserts, interactionRules } from './schema.js'

const RENAMES: readonly [oldId: string, newId: string][] = [
  ['mock-hycosan-01', 'drug-hycosan-01'],
  ['mock-hycosan-02', 'drug-hycosan-02'],
  ['mock-amlodipine-5', 'drug-amlodipine-5'],
  ['mock-atorvastatin-20', 'drug-atorvastatin-20'],
  ['mock-metformin-500', 'drug-metformin-500'],
  ['mock-glipizide-5', 'drug-glipizide-5'],
  ['mock-omeprazole-20', 'drug-omeprazole-20'],
  ['mock-cefuroxime-axetil-025', 'drug-cefuroxime-axetil-025'],
  ['mock-levofloxacin-eye-01', 'drug-levofloxacin-eye-01'],
]

async function main(): Promise<number> {
  let migrated = 0
  let already = 0
  let rulesUpdated = 0

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

  // interaction_rules.drug_ids 数组内元素改写（按元素精确匹配，幂等）
  const rules = await db.select().from(interactionRules)
  for (const rule of rules) {
    const ids = (rule.drugIds as string[]) ?? []
    if (!ids.some((id) => RENAMES.some(([o]) => o === id))) continue
    const newIds = ids.map((id) => RENAMES.find(([o]) => o === id)?.[1] ?? id)
    await db
      .update(interactionRules)
      .set({ drugIds: newIds, updatedAt: new Date() })
      .where(eq(interactionRules.id, rule.id))
    rulesUpdated++
    console.log(`  规则 ${rule.id}: drug_ids 已改写 → ${newIds.join(', ')}`)
  }

  const masters = await db.select({ id: drugMaster.id }).from(drugMaster)
  const inserts = await db.select({ id: packageInserts.id, drugId: packageInserts.drugId }).from(packageInserts)
  const dangling = inserts.filter((r) => !masters.some((m) => m.id === r.drugId))
  const staleRules = (await db.select().from(interactionRules)).filter((r) =>
    ((r.drugIds as string[]) ?? []).some((id) => id.startsWith('mock-')),
  )
  console.log(`\n✅ 迁移 ${migrated} 条，幂等跳过 ${already} 条，规则改写 ${rulesUpdated} 条；现存 drug_master ${masters.length} 行 / package_inserts ${inserts.length} 行`)
  if (dangling.length > 0) {
    console.error(`❌ 发现 ${dangling.length} 行 package_inserts.drugId 悬空：${dangling.map((r) => r.id).join(', ')}`)
    return 1
  }
  if (staleRules.length > 0) {
    console.error(`❌ 发现 ${staleRules.length} 条规则仍引用 mock-* ID`)
    return 1
  }
  console.log('   悬空引用检查：通过；规则库 mock-* 残留：无')
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 迁移失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
