/**
 * 咨询留痕数据访问（M3-T1 · PRD §7.5）——consult_logs / risk_events。
 *
 * 两张只写表：一次咨询 = 一行 consult_logs；若被守门拦截（L4/L3/manual-gate），额外一行 risk_events。
 * 医生端洞察（M3-T3）消费本组表出「风险事件流」「咨询历史摘要」，故 T1 就落表结构与查询接口。
 *
 * 分层纪律（M1-T7）：全部 userId 过滤；写入接口接收 service 层组装好的行对象，不做业务判断。
 */
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { consultLogs, riskEvents } from '../db/schema.js'

export type ConsultLogRow = typeof consultLogs.$inferSelect
export type ConsultLogInsert = typeof consultLogs.$inferInsert
export type RiskEventRow = typeof riskEvents.$inferSelect
export type RiskEventInsert = typeof riskEvents.$inferInsert

// ---------------------------------------------------------------------------
// 写入（一次咨询的事务内调用；consult.service 编排）
// ---------------------------------------------------------------------------

/** 写 consult_logs（每次 POST /api/consult 一行）。 */
export async function insertConsultLog(row: ConsultLogInsert): Promise<ConsultLogRow> {
  const inserted = await db.insert(consultLogs).values(row).returning()
  return inserted[0]
}

/** 写 risk_events（L4/L3/manual-gate 触发；一次拦截 = 一行）。 */
export async function insertRiskEvent(row: RiskEventInsert): Promise<RiskEventRow> {
  const inserted = await db.insert(riskEvents).values(row).returning()
  return inserted[0]
}

// ---------------------------------------------------------------------------
// 查询（M3-T3 医生端洞察消费；T1 先建接口便于集成测试断言）
// ---------------------------------------------------------------------------

/** 按用户取最近咨询历史（默认 50 条，按 createdAt 降序）。 */
export async function listConsultLogs(userId: string, limit = 50): Promise<ConsultLogRow[]> {
  return db
    .select()
    .from(consultLogs)
    .where(eq(consultLogs.userId, userId))
    .orderBy(desc(consultLogs.createdAt))
    .limit(limit)
}

/** 按用户取风险事件流（默认 50 条，按 occurredAt 降序；M3-T3 医生端按 level/type 聚合）。 */
export async function listRiskEvents(userId: string, limit = 50): Promise<RiskEventRow[]> {
  return db
    .select()
    .from(riskEvents)
    .where(eq(riskEvents.userId, userId))
    .orderBy(desc(riskEvents.occurredAt))
    .limit(limit)
}

/** 按 consultLogId 取关联风险事件（供前端"这次咨询被拦截"详情展开）。 */
export async function findRiskEventByConsultLogId(
  userId: string,
  consultLogId: string,
): Promise<RiskEventRow | undefined> {
  const rows = await db
    .select()
    .from(riskEvents)
    .where(and(eq(riskEvents.userId, userId), eq(riskEvents.consultLogId, consultLogId)))
    .limit(1)
  return rows[0]
}

/** 统计：用户咨询被拦截次数（blockedAt 非空）——供 M3-T3 医生端"咨询被拦截 N 次"。 */
export async function countBlockedConsults(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(consultLogs)
    .where(and(eq(consultLogs.userId, userId), isNotNull(consultLogs.blockedAt)))
  return row?.count ?? 0
}
