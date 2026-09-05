/**
 * records 服药记录数据访问（Drizzle builder，userId 过滤）。
 *
 * 防重复：记录 id 用确定性 `planId__date__time`，配 onConflictDoNothing —— 同 (计划,日期,时间点)
 * 只可能有一行；重复插入返回 null，由 service 转 409 CONFLICT（任务书 T7 防重复二次确认的接口面）。
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { drugs, plans, records } from '../db/schema.js'
import type { RecordStatus } from '@anxin/shared'

export type RecordRow = typeof records.$inferSelect

export function listRecordsByDate(userId: string, date: string) {
  return db.select().from(records).where(and(eq(records.userId, userId), eq(records.scheduledDate, date)))
}

export interface InsertRecordInput {
  userId: string
  planId: string
  date: string
  time: string
  status: RecordStatus
}

/**
 * 插入记录；冲突（已存在同 planId+date+time）返回 null。
 * status='taken' 时同事务扣减药品库存（stock.value −= plan.dose.value，下限 0）并首次设开封日。
 */
export async function insertRecord(input: InsertRecordInput): Promise<RecordRow | null> {
  const id = `${input.planId}__${input.date}__${input.time}`
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(records)
      .values({
        id,
        userId: input.userId,
        planId: input.planId,
        scheduledDate: input.date,
        scheduledTime: input.time,
        status: input.status,
      })
      .onConflictDoNothing()
      .returning()
    if (inserted.length === 0) return null // 重复 → 上层 409

    if (input.status === 'taken') {
      const planRows = await tx.select().from(plans).where(and(eq(plans.id, input.planId), eq(plans.userId, input.userId))).limit(1)
      const plan = planRows[0]
      if (plan) {
        const drugRows = await tx.select().from(drugs).where(and(eq(drugs.id, plan.drugId), eq(drugs.userId, input.userId))).limit(1)
        const drug = drugRows[0]
        if (drug) {
          const dose = (plan.dose as { value?: number } | null)?.value ?? 0
          const stock = drug.stock as { value: number; unit: string } | null
          const patch: Partial<typeof drugs.$inferInsert> = { updatedAt: new Date() }
          if (stock && typeof stock.value === 'number') {
            patch.stock = { ...stock, value: Math.max(0, stock.value - dose) }
          }
          if (!drug.openedAt) patch.openedAt = input.date // 三条时间线：首次服用视为开封（对齐 demo）
          await tx.update(drugs).set(patch).where(eq(drugs.id, drug.id))
        }
      }
    }
    return inserted[0]
  })
}

export async function deleteRecordsByPlanIds(userId: string, planIds: string[]): Promise<void> {
  if (planIds.length === 0) return
  await db.delete(records).where(and(eq(records.userId, userId), inArray(records.planId, planIds)))
}
