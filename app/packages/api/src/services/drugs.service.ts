/**
 * 药箱服务（业务逻辑；数据访问在 repositories/）。
 * 迁移自 demo/src/App.tsx 的 addManualDrug / deleteDrug + Cabinet 的库存推算。
 */
import { estimateStockDays, type DrugCreate, type DrugPatch } from '@anxin/shared'
import * as drugsRepo from '../repositories/drugs.repo.js'
import * as plansRepo from '../repositories/plans.repo.js'
import * as recordsRepo from '../repositories/records.repo.js'
import * as sourcesRepo from '../repositories/sources.repo.js'
import type { DrugRow } from '../repositories/drugs.repo.js'
import type { PlanRow } from '../repositories/plans.repo.js'
import { compact, newId } from '../lib/util.js'

interface Stock {
  value: number
  unit: string
}

/** DB 行 → 传输形态（timestamp 转 ISO 字符串，jsonb 收窄类型）。 */
export function toDrugDto(row: DrugRow) {
  return {
    id: row.id,
    genericName: row.genericName,
    brandName: row.brandName,
    specification: row.specification,
    form: row.form,
    manufacturer: row.manufacturer,
    drugMasterId: row.drugMasterId,
    confirmStatus: row.confirmStatus,
    stock: row.stock as Stock | null,
    openedAt: row.openedAt,
    expiry: row.expiry,
    sourceId: row.sourceId,
    confirmedAt: row.confirmedAt.toISOString(),
  }
}

/** 库存推算天数：取该药的一个 active 计划算（无库存或无生效计划 → null）。 */
function estimatedStockDaysFor(drug: DrugRow, drugPlans: PlanRow[]): number | null {
  const stock = drug.stock as Stock | null
  if (!stock || typeof stock.value !== 'number') return null
  const active = drugPlans.find((p) => p.drugId === drug.id && p.status === 'active')
  if (!active) return null
  const dose = (active.dose as { value?: number } | null)?.value ?? 0
  return estimateStockDays(stock.value, dose, active.frequency)
}

export async function listDrugs(userId: string) {
  const [drugRows, planRows] = await Promise.all([drugsRepo.listDrugs(userId), plansRepo.listPlans(userId)])
  return drugRows.map((row) => ({ ...toDrugDto(row), estimatedStockDays: estimatedStockDaysFor(row, planRows) }))
}

export async function getDrug(userId: string, id: string) {
  const row = await drugsRepo.findDrug(userId, id)
  if (!row) return undefined
  const planRows = await plansRepo.listPlans(userId, id)
  return { ...toDrugDto(row), estimatedStockDays: estimatedStockDaysFor(row, planRows) }
}

/** 手动建档：confirmStatus 固定 'manual' + 写 sources(type='manual') 留痕（PRD §7.2.6 兜底路径）。 */
export async function createManualDrug(userId: string, input: DrugCreate) {
  const now = new Date()
  const sourceId = newId('src')
  await sourcesRepo.insertSource({
    id: sourceId,
    userId,
    type: 'manual',
    confirmTrace: {
      confirmedAt: now.toISOString(),
      method: '用户直接填写（兜底路径）',
      keyFieldsSnapshot: { 药名: input.genericName, 规格: input.specification ?? '', 剂型: input.form ?? '' },
    },
  })
  const row = await drugsRepo.insertDrug({
    id: newId('drug'),
    userId,
    genericName: input.genericName,
    brandName: input.brandName ?? null,
    specification: input.specification ?? null,
    form: input.form ?? null,
    manufacturer: input.manufacturer ?? null,
    confirmStatus: 'manual',
    stock: (input.stock as Stock | null | undefined) ?? null,
    openedAt: input.openedAt ?? null,
    expiry: input.expiry ?? null,
    sourceId,
    confirmedAt: now,
  })
  return { ...toDrugDto(row), estimatedStockDays: null }
}

export async function patchDrug(userId: string, id: string, patch: DrugPatch) {
  const row = await drugsRepo.updateDrug(userId, id, compact({ ...patch }))
  if (!row) return undefined
  const planRows = await plansRepo.listPlans(userId, id)
  return { ...toDrugDto(row), estimatedStockDays: estimatedStockDaysFor(row, planRows) }
}

/** 删除药品：级联删其计划与记录（对齐 demo deleteDrug，DB 无外键故显式清）。 */
export async function deleteDrug(userId: string, id: string): Promise<boolean> {
  const existing = await drugsRepo.findDrug(userId, id)
  if (!existing) return false
  const planRows = await plansRepo.listPlans(userId, id)
  await recordsRepo.deleteRecordsByPlanIds(userId, planRows.map((p) => p.id))
  await plansRepo.deletePlansByDrug(userId, id)
  return drugsRepo.deleteDrug(userId, id)
}
