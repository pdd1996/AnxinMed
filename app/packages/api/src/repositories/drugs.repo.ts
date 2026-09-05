/**
 * drugs 药箱数据访问（Drizzle builder，全部 userId 过滤 —— 多用户边界，任务书 T7）。
 */
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { drugs } from '../db/schema.js'

export type DrugRow = typeof drugs.$inferSelect
export type DrugInsert = typeof drugs.$inferInsert

export function listDrugs(userId: string) {
  return db.select().from(drugs).where(eq(drugs.userId, userId)).orderBy(desc(drugs.createdAt))
}

export async function findDrug(userId: string, id: string): Promise<DrugRow | undefined> {
  const rows = await db.select().from(drugs).where(and(eq(drugs.id, id), eq(drugs.userId, userId))).limit(1)
  return rows[0]
}

export async function insertDrug(row: DrugInsert): Promise<DrugRow> {
  const inserted = await db.insert(drugs).values(row).returning()
  return inserted[0]
}

export async function updateDrug(userId: string, id: string, patch: Partial<DrugInsert>): Promise<DrugRow | undefined> {
  const rows = await db
    .update(drugs)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(drugs.id, id), eq(drugs.userId, userId)))
    .returning()
  return rows[0]
}

export async function deleteDrug(userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(drugs).where(and(eq(drugs.id, id), eq(drugs.userId, userId))).returning({ id: drugs.id })
  return rows.length > 0
}
