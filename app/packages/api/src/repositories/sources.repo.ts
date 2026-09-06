/**
 * sources 来源数据访问（三层追溯锚点，PRD §7.2.5）。
 * 手动建档留痕（type='manual'）与 M2-T6b 确认事务（处方/药盒来源）均经此写入；
 * 确认事务内传 exec=tx 令其与 drugs/plans/health_profiles 原子写入。
 */
import { db, type Executor } from '../db/client.js'
import { sources } from '../db/schema.js'

export type SourceRow = typeof sources.$inferSelect
export type SourceInsert = typeof sources.$inferInsert

export async function insertSource(row: SourceInsert, exec: Executor = db): Promise<SourceRow> {
  const inserted = await exec.insert(sources).values(row).returning()
  return inserted[0]
}
