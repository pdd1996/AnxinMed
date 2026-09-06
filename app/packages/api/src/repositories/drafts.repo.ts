/**
 * drafts 录入草稿数据访问（M2-T6，Drizzle builder，全部 userId 过滤 —— 多用户边界）。
 *
 * T6a 只含创建与读取（intake 落库 + GET 详情）；confirm/reject 的状态更新 resolveDraft 在 T6b 追加
 * （需事务 executor 参数，见 db/client.ts 的 Executor）。
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { drafts } from '../db/schema.js'

export type DraftRow = typeof drafts.$inferSelect
export type DraftInsert = typeof drafts.$inferInsert

export async function insertDraft(row: DraftInsert): Promise<DraftRow> {
  const inserted = await db.insert(drafts).values(row).returning()
  return inserted[0]
}

export async function findDraft(userId: string, id: string): Promise<DraftRow | undefined> {
  const rows = await db.select().from(drafts).where(and(eq(drafts.id, id), eq(drafts.userId, userId))).limit(1)
  return rows[0]
}

/** 批量按 id 取草稿（intake 落库后回读概要）；空数组短路。 */
export async function listDraftsByIds(userId: string, ids: string[]): Promise<DraftRow[]> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return []
  return db
    .select()
    .from(drafts)
    .where(and(eq(drafts.userId, userId), inArray(drafts.id, unique)))
    .orderBy(desc(drafts.createdAt))
}
