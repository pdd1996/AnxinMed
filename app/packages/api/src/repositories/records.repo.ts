/**
 * records 服药记录数据访问（Drizzle builder，userId 过滤）。
 *
 * 防重复：记录 id 用确定性 `planId__date__time`，配 onConflictDoNothing —— 同 (计划,日期,时间点)
 * 只可能有一行；重复插入返回 null，由 service 转 409 CONFLICT（任务书 T7 防重复二次确认的接口面）。
 */
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { drugs, plans, records } from '../db/schema.js'
import type { RecordStatus } from '@anxin/shared'

export type RecordRow = typeof records.$inferSelect

export function listRecordsByDate(userId: string, date: string) {
  return db.select().from(records).where(and(eq(records.userId, userId), eq(records.scheduledDate, date)))
}

/** 记录查询行（联 plans→drugs 取药名，供列表与 CSV 导出）。 */
export interface RecordWithDrug {
  id: string
  planId: string
  drugName: string
  scheduledDate: string
  scheduledTime: string
  status: RecordStatus
  actedAt: Date
}

/**
 * 按日期范围查记录（M3-T6 · GET /api/records?from&to）：联 plans→drugs 取药名，
 * 按 scheduledDate 倒序 + 时间点正序（近日在前，同日按时间）。范围闭区间 [from, to]。
 */
export function listRecordsByRange(userId: string, from: string, to: string): Promise<RecordWithDrug[]> {
  return db
    .select({
      id: records.id,
      planId: records.planId,
      drugName: drugs.genericName,
      scheduledDate: records.scheduledDate,
      scheduledTime: records.scheduledTime,
      status: records.status,
      actedAt: records.actedAt,
    })
    .from(records)
    .innerJoin(plans, eq(records.planId, plans.id))
    .innerJoin(drugs, eq(plans.drugId, drugs.id))
    .where(and(eq(records.userId, userId), gte(records.scheduledDate, from), lte(records.scheduledDate, to)))
    .orderBy(desc(records.scheduledDate), records.scheduledTime)
}

/** 范围内状态聚合（PG 原生 count(*) filter，不用应用层聚合——对齐 M3-T3 依从性统计口径）。 */
export async function summarizeRecordsByRange(
  userId: string,
  from: string,
  to: string,
): Promise<{ total: number; taken: number; skipped: number; later: number }> {
  const rows = await db
    .select({
      total: sql<number>`count(*)`,
      taken: sql<number>`count(*) filter (where ${records.status} = 'taken')`,
      skipped: sql<number>`count(*) filter (where ${records.status} = 'skipped')`,
      later: sql<number>`count(*) filter (where ${records.status} = 'later')`,
    })
    .from(records)
    .where(and(eq(records.userId, userId), gte(records.scheduledDate, from), lte(records.scheduledDate, to)))
  const r = rows[0]
  return {
    total: Number(r?.total ?? 0),
    taken: Number(r?.taken ?? 0),
    skipped: Number(r?.skipped ?? 0),
    later: Number(r?.later ?? 0),
  }
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
