/**
 * health_profiles 数据访问（Drizzle builder，全部 userId 过滤 —— 多用户边界）。
 * 表上无 (user_id, field_key) 唯一约束，故 upsert 在应用层 select-then-write（MVP 单用户并发可忽略）。
 */
import { and, eq } from 'drizzle-orm'
import { db, type Executor } from '../db/client.js'
import { healthProfiles } from '../db/schema.js'

export type HealthRow = typeof healthProfiles.$inferSelect
export type HealthInsert = typeof healthProfiles.$inferInsert

export type HealthSourceMeta = {
  source: 'self_reported' | 'prescription_confirmed'
  confirmedAt?: string
}

export function listByUser(userId: string) {
  return db
    .select()
    .from(healthProfiles)
    .where(eq(healthProfiles.userId, userId))
    .orderBy(healthProfiles.createdAt)
}

export async function findByField(userId: string, fieldKey: string, exec: Executor = db): Promise<HealthRow | undefined> {
  const rows = await exec
    .select()
    .from(healthProfiles)
    .where(and(eq(healthProfiles.userId, userId), eq(healthProfiles.fieldKey, fieldKey)))
    .limit(1)
  return rows[0]
}

export async function insertHealth(row: HealthInsert, exec: Executor = db): Promise<HealthRow> {
  const inserted = await exec.insert(healthProfiles).values(row).returning()
  return inserted[0]
}

export async function updateHealth(
  userId: string,
  fieldKey: string,
  patch: { value?: string | null; sourceMeta?: HealthSourceMeta | null },
  exec: Executor = db,
): Promise<HealthRow | undefined> {
  const rows = await exec
    .update(healthProfiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(healthProfiles.userId, userId), eq(healthProfiles.fieldKey, fieldKey)))
    .returning()
  return rows[0]
}

export async function deleteByField(userId: string, fieldKey: string): Promise<boolean> {
  const rows = await db
    .delete(healthProfiles)
    .where(and(eq(healthProfiles.userId, userId), eq(healthProfiles.fieldKey, fieldKey)))
    .returning({ id: healthProfiles.id })
  return rows.length > 0
}
