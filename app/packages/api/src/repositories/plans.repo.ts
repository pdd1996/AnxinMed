/**
 * plans 计划数据访问（Drizzle builder，全部 userId 过滤）。
 * 今日生效判定用 shared 的 isPlanActiveOn（在 tasks.service 内过滤），repo 只负责取数。
 */
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { plans } from '../db/schema.js'

export type PlanRow = typeof plans.$inferSelect
export type PlanInsert = typeof plans.$inferInsert

export function listPlans(userId: string, drugId?: string) {
  const where = drugId ? and(eq(plans.userId, userId), eq(plans.drugId, drugId)) : eq(plans.userId, userId)
  return db.select().from(plans).where(where).orderBy(desc(plans.createdAt))
}

export async function findPlan(userId: string, id: string): Promise<PlanRow | undefined> {
  const rows = await db.select().from(plans).where(and(eq(plans.id, id), eq(plans.userId, userId))).limit(1)
  return rows[0]
}

export async function insertPlan(row: PlanInsert): Promise<PlanRow> {
  const inserted = await db.insert(plans).values(row).returning()
  return inserted[0]
}

export async function updatePlan(userId: string, id: string, patch: Partial<PlanInsert>): Promise<PlanRow | undefined> {
  const rows = await db
    .update(plans)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(plans.id, id), eq(plans.userId, userId)))
    .returning()
  return rows[0]
}

export async function deletePlan(userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(plans).where(and(eq(plans.id, id), eq(plans.userId, userId))).returning({ id: plans.id })
  return rows.length > 0
}

/** 药品删除时级联删其计划（返回被删计划 id，供上层清记录）。 */
export async function deletePlansByDrug(userId: string, drugId: string): Promise<string[]> {
  const rows = await db
    .delete(plans)
    .where(and(eq(plans.userId, userId), eq(plans.drugId, drugId)))
    .returning({ id: plans.id })
  return rows.map((r) => r.id)
}
