/**
 * 医患绑定数据访问（specs/25）——只做 SQL，不做业务判断。
 *
 * 不变式（见 db/schema.ts doctor_patient_links 注释）：
 * - 作用域唯一来源 = status='active' 的关系行；
 * - 解绑保留历史（status='revoked'），不物理删除；
 * - 医生/患者身份不在此层校验（由 service 依认证态裁决）。
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { doctorBindCodes, doctorPatientLinks, users } from '../db/schema.js'

/** 医生当前授权患者 id 列表（按绑定时间倒序，供作用域过滤）。 */
export async function listActivePatientIds(doctorId: string): Promise<string[]> {
  const rows = await db
    .select({ patientId: doctorPatientLinks.patientId })
    .from(doctorPatientLinks)
    .where(and(eq(doctorPatientLinks.doctorId, doctorId), eq(doctorPatientLinks.status, 'active')))
    .orderBy(doctorPatientLinks.boundAt)
  return rows.map((r) => r.patientId)
}

/** 患者当前绑定的医生（含绑定时间；医生姓名由 service 批量补齐）。 */
export async function listActiveDoctorLinks(
  patientId: string,
): Promise<Array<{ doctorId: string; boundAt: Date }>> {
  const rows = await db
    .select({ doctorId: doctorPatientLinks.doctorId, boundAt: doctorPatientLinks.boundAt })
    .from(doctorPatientLinks)
    .where(and(eq(doctorPatientLinks.patientId, patientId), eq(doctorPatientLinks.status, 'active')))
    .orderBy(doctorPatientLinks.boundAt)
  return rows
}

/** 查单条关系（含已解绑历史）。 */
export async function findLink(doctorId: string, patientId: string) {
  const [row] = await db
    .select()
    .from(doctorPatientLinks)
    .where(and(eq(doctorPatientLinks.doctorId, doctorId), eq(doctorPatientLinks.patientId, patientId)))
    .limit(1)
  return row ?? null
}

/** 是否为有效授权（医生端单患者路径的前置校验）。 */
export async function isBound(doctorId: string, patientId: string): Promise<boolean> {
  const row = await findLink(doctorId, patientId)
  return row?.status === 'active'
}

/**
 * 建立 / 恢复授权（同一医生-患者对唯一）。
 * - 首次绑定：插入 active 行（source = bind-code）；
 * - 解绑后重新绑定：更新为 active 并刷新 boundAt、清空 revokedAt。
 */
export async function upsertActiveLink(input: {
  id: string
  doctorId: string
  patientId: string
  source: 'seed' | 'bind-code'
}) {
  const now = new Date()
  const [row] = await db
    .insert(doctorPatientLinks)
    .values({
      id: input.id,
      doctorId: input.doctorId,
      patientId: input.patientId,
      status: 'active',
      source: input.source,
      boundAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [doctorPatientLinks.doctorId, doctorPatientLinks.patientId],
      set: {
        status: 'active',
        source: input.source,
        boundAt: now,
        revokedAt: null,
        updatedAt: now,
      },
    })
    .returning()
  return row!
}

/** 解绑：把 active 行置 revoked（幂等：已解绑返回 null）。 */
export async function revokeLink(doctorId: string, patientId: string) {
  const now = new Date()
  const [row] = await db
    .update(doctorPatientLinks)
    .set({ status: 'revoked', revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(doctorPatientLinks.doctorId, doctorId),
        eq(doctorPatientLinks.patientId, patientId),
        eq(doctorPatientLinks.status, 'active'),
      ),
    )
    .returning()
  return row ?? null
}

/** 批量取用户显示名（医生/患者通用；只取展示所需列，绝不含凭据列）。 */
export async function findUserNames(ids: string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids))
  return new Map(rows.map((r) => [r.id, r.name]))
}

// ---------------------------------------------------------------------------
// 绑定码
// ---------------------------------------------------------------------------

export async function deleteUnusedCodes(doctorId: string): Promise<void> {
  await db
    .delete(doctorBindCodes)
    .where(and(eq(doctorBindCodes.doctorId, doctorId), isNull(doctorBindCodes.usedAt)))
}

export async function insertBindCode(row: {
  id: string
  code: string
  doctorId: string
  expiresAt: Date
}): Promise<void> {
  await db.insert(doctorBindCodes).values(row)
}

export async function findBindCode(code: string) {
  const [row] = await db.select().from(doctorBindCodes).where(eq(doctorBindCodes.code, code)).limit(1)
  return row ?? null
}

/**
 * 原子核销：只有仍未被使用且未过期的码才会被更新成功（并发下只有一个患者能成功）。
 * 返回 true = 本次核销成功；false = 已被使用（或恰好过期）。
 */
export async function markBindCodeUsed(id: string, patientId: string): Promise<boolean> {
  const [row] = await db
    .update(doctorBindCodes)
    .set({ usedAt: new Date(), usedByPatientId: patientId })
    .where(and(eq(doctorBindCodes.id, id), isNull(doctorBindCodes.usedAt)))
    .returning({ id: doctorBindCodes.id })
  return Boolean(row)
}
