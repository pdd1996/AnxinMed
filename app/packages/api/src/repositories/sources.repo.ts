/**
 * sources 来源数据访问（三层追溯锚点，PRD §7.2.5）。
 * T7 仅用于手动建档留痕（type='manual'）；处方/药盒来源在 M2 确认事务写入。
 */
import { db } from '../db/client.js'
import { sources } from '../db/schema.js'

export type SourceRow = typeof sources.$inferSelect
export type SourceInsert = typeof sources.$inferInsert

export async function insertSource(row: SourceInsert): Promise<SourceRow> {
  const inserted = await db.insert(sources).values(row).returning()
  return inserted[0]
}
