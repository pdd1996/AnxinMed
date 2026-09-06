/**
 * 资产域数据访问（M2-T5 + M3-T1）——drug_master / package_inserts / interaction_rules。
 *
 * 资产域是 Mock 三库（write-once，与用户域分离，无 userId）；规则引擎（services/rules）为纯函数，
 * 由此仓储取数后经 plans.service 编排传入。字段裁剪到匹配/校验所需，避免把整库拖进内存。
 */
import { eq, ilike, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { drugMaster, packageInserts, interactionRules } from '../db/schema.js'

export type InteractionRuleRow = typeof interactionRules.$inferSelect
export type PackageInsertRow = typeof packageInserts.$inferSelect

/** drug_master 匹配候选（裁剪到 matchDrugMaster 所需列，结构兼容 identity/match 的 DrugMasterCandidate）。 */
export interface DrugMasterCandidateRow {
  id: string
  genericName: string
  brandName: string | null
  specification: string
  form: string
  manufacturer: string | null
  approvalNumber: string | null
}

/** 全量 drug_master 候选（MVP 精选库规模小；正式版可按名预筛）。供身份线三项严格匹配。 */
export function listDrugMasterCandidates(): Promise<DrugMasterCandidateRow[]> {
  return db
    .select({
      id: drugMaster.id,
      genericName: drugMaster.genericName,
      brandName: drugMaster.brandName,
      specification: drugMaster.specification,
      form: drugMaster.form,
      manufacturer: drugMaster.manufacturer,
      approvalNumber: drugMaster.approvalNumber,
    })
    .from(drugMaster)
}

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

/** 说明书范围校验切片（裁剪到 dosage/source/version；管线按 drug_master.id 建映射）。 */
export interface PackageInsertSliceRow {
  drugId: string
  dosage: unknown
  source: string | null
  version: string | null
}

/** 全量说明书切片（MVP 精选库规模小）——供管线范围校验按 masterId 查取。 */
export function listPackageInsertSlices(): Promise<PackageInsertSliceRow[]> {
  return db
    .select({
      drugId: packageInserts.drugId,
      dosage: packageInserts.dosage,
      source: packageInserts.source,
      version: packageInserts.version,
    })
    .from(packageInserts)
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

/**
 * 按通用名模糊匹配说明书候选（M3-T1 · manual 档兜底路径）。
 *
 * 用途：手动建档药品（drugMasterId=null）仅可做 L0 资料查询，需按药名兜底命中说明书。
 * SQL 层用 ilike 做子串初筛（MVP 精选库规模小，命中候选通常 ≤5 条）；
 * 精筛（归一化双向子串 nameMatches）由 service 层完成，避免 repo 层依赖 service 纯函数。
 *
 * @param genericName 用户药箱的 genericName（drugs.genericName）
 * @returns 候选说明书行（可能为空；service 层用 nameMatches 精筛取第一条）
 */
export async function listPackageInsertsByGenericNameLike(
  genericName: string,
): Promise<PackageInsertRow[]> {
  const name = String(genericName ?? '').trim()
  if (!name) return []
  return db
    .select()
    .from(packageInserts)
    .where(ilike(packageInserts.genericName, `%${name}%`))
    .limit(5)
}
