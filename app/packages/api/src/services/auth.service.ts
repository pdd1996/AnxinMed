/**
 * G7 认证服务（过渡实现 · ADR #20 增补）——账号密码登录、会话 token、失败限流。
 *
 * 定位：ADR #11 的 Better Auth + 手机号验证码仍为 P1 目标；本文件是 G7 最小实现，
 *      `resolveUser` 为唯一替换点（换 Better Auth session 时下游路由不动）。
 *
 * 安全约束：
 * - 密码只存 scrypt 哈希（lib/auth/password.ts）；对外一律走 publicUser()，绝不带 passwordHash；
 * - token 32 字节随机，DB 只存 SHA-256；7 天过期，登出即删行；
 * - 登录失败统一 401 AUTH_INVALID（不区分「账号不存在」与「密码错误」，防账号枚举）；
 * - 同一「IP|账号」5 次失败/15 分钟锁定（单实例内存；多实例前需换共享存储，已登记 G7 任务书）；
 * - 未开通登录（passwordHash=null）的账号不能登录——demo 用户即如此，需 CLI 开通。
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import { ERR_CODES, LOGIN_FAILED_MESSAGE, LOGIN_LOCKED_MESSAGE, type AuthUser } from '@anxin/shared'
import { db } from '../db/client.js'
import { sessions, users } from '../db/schema.js'
import { hashPassword, verifyPassword } from '../lib/auth/password.js'
import { ApiError } from '../lib/http.js'
import type { User } from '../types.js'

/** 演示用户 id（demo 旁路与 /api/auth/me 共用；由 db:seed-users 写入）。 */
export const DEMO_USER_ID = 'p-001'

/** 会话有效期：7 天固定窗口（过期需重新登录）。 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 登录失败限流：同一「IP|账号」5 次失败 / 15 分钟。 */
const MAX_FAILED_ATTEMPTS = 5
const LOCK_WINDOW_MS = 15 * 60 * 1000

interface AttemptState {
  failures: number[]
  lockedUntil: number
}

/** 单实例内存限流（staging 单容器；进程重启清零，可接受）。 */
const attempts = new Map<string, AttemptState>()

/** 清空限流状态（测试用；运维重启进程同样清零）。 */
export function resetLoginAttempts(): void {
  attempts.clear()
}

function lockRemainingMs(key: string): number {
  const state = attempts.get(key)
  if (!state) return 0
  return Math.max(0, state.lockedUntil - Date.now())
}

/** 记录一次失败；返回是否触发锁定。 */
function recordFailure(key: string): boolean {
  const now = Date.now()
  const state = attempts.get(key) ?? { failures: [], lockedUntil: 0 }
  state.failures = state.failures.filter((t) => now - t < LOCK_WINDOW_MS)
  state.failures.push(now)
  if (state.failures.length >= MAX_FAILED_ATTEMPTS) {
    state.lockedUntil = now + LOCK_WINDOW_MS
    state.failures = []
  }
  attempts.set(key, state)
  return state.lockedUntil > now
}

function clearFailures(key: string): void {
  attempts.delete(key)
}

/** 对外安全用户对象（绝不带 password_hash / email / phone）。 */
export function publicUser(user: User): AuthUser {
  return { id: user.id, name: user.name, username: user.username }
}

/** 从 Authorization 头取 Bearer token（大小写不敏感）。 */
export function readBearer(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

/** token 落库形态：SHA-256（token 本身高熵，无需慢哈希）。 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** demo 旁路用户（读不到即 500，不静默）。 */
export async function getDemoUser(): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, DEMO_USER_ID)).limit(1)
  if (!user) throw new ApiError(500, 'INTERNAL', `演示用户 ${DEMO_USER_ID} 未找到，请先运行 db:seed-users`)
  return user
}

/**
 * 账号不存在时也跑一次 scrypt：避免用响应耗时枚举账号是否存在。
 * 懒初始化（首次登录失败时算一次，之后复用）。
 */
let dummyHashPromise: Promise<string> | null = null
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(16).toString('hex'))
  return dummyHashPromise
}

/**
 * 登录：成功返回 token 明文 + 用户行（调用方必须只输出 publicUser）。
 * 失败统一 401 AUTH_INVALID；连续失败触发 429 AUTH_LOCKED。
 *
 * @param clientKey 客户端标识（取 x-forwarded-for 首段；直连测试为 'local'）
 */
export async function login(
  username: string,
  password: string,
  clientKey = 'local',
): Promise<{ token: string; user: User }> {
  const key = `${clientKey}|${username}`
  if (lockRemainingMs(key) > 0) {
    throw new ApiError(429, ERR_CODES.AUTH_LOCKED, LOGIN_LOCKED_MESSAGE)
  }

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1)
  // 未开通登录的账号也走一次比对（dummy hash），失败文案与密码错误一致。
  const hash = user?.passwordHash ?? (await dummyHash())
  const matched = await verifyPassword(password, hash)
  if (!user || !user.passwordHash || !matched) {
    if (recordFailure(key)) throw new ApiError(429, ERR_CODES.AUTH_LOCKED, LOGIN_LOCKED_MESSAGE)
    throw new ApiError(401, ERR_CODES.AUTH_INVALID, LOGIN_FAILED_MESSAGE)
  }
  clearFailures(key)

  // 懒清理过期会话（单机 demo 规模够用，不做后台任务）。
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))

  const token = randomBytes(32).toString('base64url')
  await db.insert(sessions).values({
    id: `sess-${randomUUID()}`,
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  return { token, user }
}

/** 登出：删除会话（无效 token 幂等不报错）。 */
export async function logout(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
}

/** 用 token 解析当前用户：不存在/过期 → null（过期行顺手删）。 */
export async function resolveSessionUser(token: string): Promise<User | null> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1)
  if (!session) return null
  if (session.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, session.id))
    return null
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1)
  if (!user) return null
  await db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, session.id))
  return user
}

/**
 * 改显示名（PATCH /api/auth/me 的唯一字段）。返回更新后的用户行；调用方仍必须过 publicUser。
 *
 * 空名/超长由契约层（shared UpdateMeRequestSchema）拦；此处再兜一次是因为本函数也可能被
 * CLI 或后续路由直接调用，service 不能假设入参已经校验（防御性，不是重复校验业务规则）。
 */
export async function updateUserName(userId: string, name: string): Promise<User> {
  const trimmed = name.trim()
  if (!trimmed) throw new ApiError(400, ERR_CODES.VALIDATION, '请输入姓名')
  const [updated] = await db
    .update(users)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()
  // 会话有效但用户行消失（外部清理）：报 404 而不是静默返回旧值。
  if (!updated) throw new ApiError(404, ERR_CODES.NOT_FOUND, '用户不存在')
  return updated
}

/**
 * CLI：开通账号（id 已存在则更新凭据；否则新建用户）。不开放 HTTP 自助注册。
 * 用户名冲突由 DB 唯一约束兜底（CLI 捕获并报错可见）。
 */
export async function createUserCredential(input: {
  id?: string
  username: string
  password: string
  name?: string | null
}): Promise<User> {
  const passwordHash = await hashPassword(input.password)
  const now = new Date()

  if (input.id) {
    const [existing] = await db.select().from(users).where(eq(users.id, input.id)).limit(1)
    if (existing) {
      const [updated] = await db
        .update(users)
        .set({
          username: input.username,
          passwordHash,
          passwordUpdatedAt: now,
          updatedAt: now,
          ...(input.name !== undefined ? { name: input.name } : {}),
        })
        .where(eq(users.id, input.id))
        .returning()
      return updated!
    }
  }

  const [created] = await db
    .insert(users)
    .values({
      id: input.id ?? `u-${randomUUID()}`,
      name: input.name ?? null,
      username: input.username,
      passwordHash,
      passwordUpdatedAt: now,
    })
    .returning()
  return created!
}

/** CLI：按账号重置密码；账号不存在返回 null（CLI 报错可见）。 */
export async function resetPassword(username: string, password: string): Promise<User | null> {
  const passwordHash = await hashPassword(password)
  const now = new Date()
  const [updated] = await db
    .update(users)
    .set({ passwordHash, passwordUpdatedAt: now, updatedAt: now })
    .where(eq(users.username, username))
    .returning()
  return updated ?? null
}
