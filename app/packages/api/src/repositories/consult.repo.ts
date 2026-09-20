/**
 * 咨询留痕数据访问（M3-T1 · PRD §7.5）——consult_sessions / consult_logs / risk_events。
 *
 * consult_sessions（M4-T5）：一次续问链 = 一行会话；title=首问截断，last_active_at 每轮刷新。
 * 两张只写表：一次咨询 = 一行 consult_logs；若被守门拦截（L4/L3/manual-gate），额外一行 risk_events。
 * 医生端洞察（M3-T3）消费本组表出「风险事件流」「咨询历史摘要」。
 *
 * 分层纪律（M1-T7）：全部 userId 过滤；写入接口接收 service 层组装好的行对象，不做业务判断。
 */
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { consultLogs, consultSessions, consultSuggestions, riskEvents } from '../db/schema.js'

export type ConsultLogRow = typeof consultLogs.$inferSelect
export type ConsultLogInsert = typeof consultLogs.$inferInsert
export type RiskEventRow = typeof riskEvents.$inferSelect
export type RiskEventInsert = typeof riskEvents.$inferInsert
export type ConsultSessionRow = typeof consultSessions.$inferSelect
export type ConsultSessionInsert = typeof consultSessions.$inferInsert
export type ConsultSuggestionRow = typeof consultSuggestions.$inferSelect
export type ConsultSuggestionInsert = typeof consultSuggestions.$inferInsert

// ---------------------------------------------------------------------------
// 写入（一次咨询的事务内调用；consult.service 编排）
// ---------------------------------------------------------------------------

/** 写 consult_sessions（M4-T5：首问建会话；后续轮 updateSessionActivity 刷新活跃时间）。 */
export async function insertConsultSession(row: ConsultSessionInsert): Promise<ConsultSessionRow> {
  const inserted = await db.insert(consultSessions).values(row).returning()
  return inserted[0]
}

/** 写 consult_logs（每次 POST /api/consult 一行）。 */
export async function insertConsultLog(row: ConsultLogInsert): Promise<ConsultLogRow> {
  const inserted = await db.insert(consultLogs).values(row).returning()
  return inserted[0]
}

// ---------------------------------------------------------------------------
// 会话查询（M4-T5；全部 userId 过滤——跨用户不串会话）
// ---------------------------------------------------------------------------

/** 按 id 取会话（userId 过滤；不属于该用户 = 未命中，不泄漏资源存在性）。 */
export async function findConsultSession(userId: string, sessionId: string): Promise<ConsultSessionRow | undefined> {
  const rows = await db
    .select()
    .from(consultSessions)
    .where(and(eq(consultSessions.userId, userId), eq(consultSessions.id, sessionId)))
    .limit(1)
  return rows[0]
}

/** 会话列表（按 last_active_at 倒序，默认 20 条）。 */
export async function listConsultSessions(userId: string, limit = 20): Promise<ConsultSessionRow[]> {
  return db
    .select()
    .from(consultSessions)
    .where(eq(consultSessions.userId, userId))
    .orderBy(desc(consultSessions.lastActiveAt))
    .limit(limit)
}

/** 会话内消息回放（按 turn_no 升序；userId 过滤）。 */
export async function listConsultLogsBySession(
  userId: string,
  sessionId: string,
): Promise<ConsultLogRow[]> {
  return db
    .select()
    .from(consultLogs)
    .where(and(eq(consultLogs.userId, userId), eq(consultLogs.sessionId, sessionId)))
    .orderBy(asc(consultLogs.turnNo), asc(consultLogs.createdAt))
}

/** 会话内已有轮次数（下一轮 turn_no = count + 1；MVP 单用户并发可忽略竞态）。 */
export async function countSessionTurns(userId: string, sessionId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(consultLogs)
    .where(and(eq(consultLogs.userId, userId), eq(consultLogs.sessionId, sessionId)))
  return row?.count ?? 0
}

/** 刷新会话活跃时间（每轮续问后调用）。用库时钟 now()——与建会话的 defaultNow() 同源，
 *  避免应用/库时钟混用造成的时区偏差（timestamp 无时区列，JS Date 与 now() 混写会错位）。 */
export async function touchConsultSession(userId: string, sessionId: string): Promise<void> {
  await db
    .update(consultSessions)
    .set({ lastActiveAt: sql`now()` })
    .where(and(eq(consultSessions.userId, userId), eq(consultSessions.id, sessionId)))
}

// ---------------------------------------------------------------------------
// 建议卡（M4-T6 · specs/04-T6）—— add_drug 落库留痕；note_symptom 不落库（裁决 #4）
// ---------------------------------------------------------------------------

/** 写 consult_suggestions（add_drug 卡，pending 起步）。 */
export async function insertConsultSuggestion(row: ConsultSuggestionInsert): Promise<ConsultSuggestionRow> {
  const inserted = await db.insert(consultSuggestions).values(row).returning()
  return inserted[0]
}

/** 按 id 取建议卡（userId 过滤；跨用户 = 未命中，不泄漏存在性）。 */
export async function findConsultSuggestion(
  userId: string,
  suggestionId: string,
): Promise<ConsultSuggestionRow | undefined> {
  const rows = await db
    .select()
    .from(consultSuggestions)
    .where(and(eq(consultSuggestions.userId, userId), eq(consultSuggestions.id, suggestionId)))
    .limit(1)
  return rows[0]
}

/** 置建议卡状态（accept → accepted / dismiss → dismissed；acted_at 用库时钟）。 */
export async function setConsultSuggestionStatus(
  userId: string,
  suggestionId: string,
  status: 'accepted' | 'dismissed',
): Promise<ConsultSuggestionRow | undefined> {
  const rows = await db
    .update(consultSuggestions)
    .set({ status, actedAt: sql`now()`, updatedAt: new Date() })
    .where(and(eq(consultSuggestions.userId, userId), eq(consultSuggestions.id, suggestionId)))
    .returning()
  return rows[0]
}

/** 会话内已落库的 add_drug 卡数（频控「每会话 ≤3」；accept/dismiss 后仍计数）。 */
export async function countSessionSuggestions(userId: string, sessionId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(consultSuggestions)
    .where(
      and(
        eq(consultSuggestions.userId, userId),
        eq(consultSuggestions.sessionId, sessionId),
        eq(consultSuggestions.type, 'add_drug'),
      ),
    )
  return row?.count ?? 0
}

/** 会话内 dismissed 的 add_drug 药名（dismissed 不复弹的排除集）。 */
export async function listDismissedSuggestionNames(userId: string, sessionId: string): Promise<string[]> {
  const rows = await db
    .select({ payload: consultSuggestions.payload })
    .from(consultSuggestions)
    .where(
      and(
        eq(consultSuggestions.userId, userId),
        eq(consultSuggestions.sessionId, sessionId),
        eq(consultSuggestions.type, 'add_drug'),
        eq(consultSuggestions.status, 'dismissed'),
      ),
    )
  return rows.map((r) => String((r.payload as { drugName?: string } | null)?.drugName ?? '')).filter(Boolean)
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
