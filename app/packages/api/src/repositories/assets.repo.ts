/**
 * 资产域数据访问（M2-T5）——drug_master / package_inserts / interaction_rules。
 *
 * 资产域是 Mock 三库（write-once，与用户域分离，无 userId）；规则引擎（services/rules）为纯函数，
 * 由此仓储取数后经 plans.service 编排传入。字段裁剪到匹配/校验所需，避免把整库拖进内存。
 */
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { drugMaster, packageInserts, interactionRules } from '../db/schema.js'

export type InteractionRuleRow = typeof interactionRules.$inferSelect
export type PackageInsertRow = typeof packageInserts.$inferSelect

/** 全量相互作用规则（MVP 精选库规模小；正式版可改为按相关药预筛）。 */
export function listInteractionRules(): Promise<InteractionRuleRow[]> {
  return db.select().from(interactionRules)
}

/** 按 drug_master.id 取说明书（package_inserts.drugId → drug_master.id）。 */
export async function findPackageInsertByDrugMasterId(
  drugMasterId: string,
): Promise<PackageInsertRow | undefined> {
  const rows = await db
    .select()
    .from(packageInserts)
    .where(eq(packageInserts.drugId, drugMasterId))
    .limit(1)
  return rows[0]
}

/** 批量取 drug_master 通用名（id → genericName），供相互作用命中项展示药名。 */
export async function findDrugMasterNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return {}
  const rows = await db
    .select({ id: drugMaster.id, genericName: drugMaster.genericName })
    .from(drugMaster)
    .where(inArray(drugMaster.id, unique))
  return Object.fromEntries(rows.map((r) => [r.id, r.genericName]))
}
