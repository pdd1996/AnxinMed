/**
 * P1 增补 · 登录后设置 / 修改密码 集成测试。
 *
 * 覆盖：手机号账号补密码（账号名自动取手机号）→ 之后可用「手机号 + 密码」登录；
 *      已有密码账号改密必须校验旧密码（错误 400 AUTH_PASSWORD_INVALID，故意不用 401）；
 *      密码长度契约、无手机号/账号名账号拒绝、账号名冲突 409、demo 模式拒绝、无 token 401。
 *
 * 环境：beforeAll 切 AUTH_MODE=password，直接插测试用户并用 issueSession 发 token（不经短信通道）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import {
  AUTH_REQUIRED_MESSAGE,
  LOGIN_FAILED_MESSAGE,
  PASSWORD_INVALID_MESSAGE,
  PASSWORD_NOT_SUPPORTED_MESSAGE,
  PASSWORD_USERNAME_CONFLICT_MESSAGE,
} from '@anxin/shared'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { sessions, users } from '../db/schema.js'
import { hashPassword } from '../lib/auth/password.js'
import { issueSession, resetLoginAttempts } from '../services/auth.service.js'
import type { User } from '../types.js'

const U_PHONE = 'auth-pwd-phone'
const U_PHONE_CONFLICT = 'auth-pwd-phone-conflict'
const U_PWD = 'auth-pwd-user'
const U_RAW = 'auth-pwd-raw'
const U_CONFLICT = 'auth-pwd-conflict'

const PHONE = '13700001111'
const PHONE_CONFLICT = '13700002222'
const PWD_USERNAME = 'auth-pwd-acct'
const OLD_PASSWORD = 'Old-pass-123'

const USER_IDS = [U_PHONE, U_PHONE_CONFLICT, U_PWD, U_RAW, U_CONFLICT]

let tokens: Record<string, string> = {}

type Envelope = {
  ok: boolean
  code?: string
  message?: string
  mode?: string
  user?: { id: string; name: string | null; username: string | null; hasPassword?: boolean }
}

function postPassword(token: string | null, body: unknown) {
  return app.request('/api/auth/password', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

function postLogin(username: string, password: string, ip = '10.9.0.1') {
  return app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username, password }),
  })
}

async function cleanup(): Promise<void> {
  await db.delete(sessions).where(inArray(sessions.userId, USER_IDS))
  await db.delete(users).where(inArray(users.id, USER_IDS))
}

/** 给同一用户再造一个会话（模拟「另一台设备」），用于验证「改密即清其他设备会话」。 */
async function anotherSession(userId: string): Promise<string> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!row) throw new Error(`测试用户不存在：${userId}`)
  return issueSession(row)
}

/** 用某 token 访问 /api/auth/me，返回状态码（200=会话有效，401=已失效）。 */
async function meStatus(token: string): Promise<number> {
  const res = await app.request('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
  return res.status
}

beforeAll(async () => {
  process.env.AUTH_MODE = 'password'
  await cleanup()

  const now = new Date()
  const inserted = await db
    .insert(users)
    .values([
      { id: U_PHONE, phone: PHONE, phoneVerifiedAt: now },
      { id: U_PHONE_CONFLICT, phone: PHONE_CONFLICT, phoneVerifiedAt: now },
      {
        id: U_CONFLICT,
        username: PHONE_CONFLICT,
        passwordHash: await hashPassword('Conflict-pass-123'),
        passwordUpdatedAt: now,
      },
      {
        id: U_PWD,
        username: PWD_USERNAME,
        passwordHash: await hashPassword(OLD_PASSWORD),
        passwordUpdatedAt: now,
      },
      { id: U_RAW },
    ])
    .returning()

  const byId = new Map<string, User>(inserted.map((u) => [u.id, u]))
  tokens = {}
  for (const id of USER_IDS) {
    tokens[id] = await issueSession(byId.get(id)!)
  }
})

afterAll(async () => {
  await cleanup()
  delete process.env.AUTH_MODE
  resetLoginAttempts()
})

beforeEach(() => {
  resetLoginAttempts()
})

describe('POST /api/auth/password —— 鉴权与模式', () => {
  it('无 token → 401 AUTH_REQUIRED', async () => {
    const res = await postPassword(null, { password: 'New-pass-123' })
    expect(res.status).toBe(401)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('AUTH_REQUIRED')
    expect(body.message).toBe(AUTH_REQUIRED_MESSAGE)
  })

  it('demo 模式 → 400 明确拒绝（不出现密码概念）', async () => {
    process.env.AUTH_MODE = 'demo'
    try {
      const res = await postPassword(tokens[U_PHONE]!, { password: 'New-pass-123' })
      expect(res.status).toBe(400)
      expect(((await res.json()) as Envelope).code).toBe('VALIDATION')
    } finally {
      process.env.AUTH_MODE = 'password'
    }
  })
})

describe('手机号账号补密码（验证码即注册的账号）', () => {
  it('无旧密码即可设置：账号名自动取手机号，响应 hasPassword=true，并清掉其他设备会话', async () => {
    const otherDevice = await anotherSession(U_PHONE)
    expect(await meStatus(otherDevice)).toBe(200)

    const res = await postPassword(tokens[U_PHONE]!, { password: 'New-pass-123' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('password')
    expect(body.user).toMatchObject({ id: U_PHONE, username: PHONE, hasPassword: true })

    // 改密即清其他设备：当前会话保留，另一台会话失效
    expect(await meStatus(tokens[U_PHONE]!)).toBe(200)
    expect(await meStatus(otherDevice)).toBe(401)

    // 之后可用「手机号 + 密码」走密码登录
    const login = await postLogin(PHONE, 'New-pass-123', '10.9.0.2')
    expect(login.status).toBe(200)
    const loginBody = (await login.json()) as Envelope & { token?: string }
    expect(loginBody.token).toBeTruthy()
    expect(loginBody.user?.id).toBe(U_PHONE)
  })

  it('密码过短 → 400 VALIDATION（shared 契约提示），不改库', async () => {
    const res = await postPassword(tokens[U_PHONE]!, { password: 'short' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('VALIDATION')
    expect(body.message).toContain('至少 8 位')
  })

  it('账号名冲突（已有同号账号名）→ 409 CONFLICT 可见报错', async () => {
    const res = await postPassword(tokens[U_PHONE_CONFLICT]!, { password: 'New-pass-123' })
    expect(res.status).toBe(409)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('CONFLICT')
    expect(body.message).toBe(PASSWORD_USERNAME_CONFLICT_MESSAGE)
  })

  it('无手机号且无账号名（seed 演示用户）→ 400 明确提示不支持自助设密', async () => {
    const res = await postPassword(tokens[U_RAW]!, { password: 'New-pass-123' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('VALIDATION')
    expect(body.message).toBe(PASSWORD_NOT_SUPPORTED_MESSAGE)
  })
})

describe('已有密码账号改密', () => {
  it('缺旧密码 → 400 AUTH_PASSWORD_INVALID（不是 401，避免前端误清登录态）', async () => {
    const res = await postPassword(tokens[U_PWD]!, { password: 'New-pass-456' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('AUTH_PASSWORD_INVALID')
    expect(body.message).toBe(PASSWORD_INVALID_MESSAGE)
  })

  it('旧密码错误 → 400 AUTH_PASSWORD_INVALID，且**不**撤销其他设备会话（失败不该踢人）', async () => {
    const otherDevice = await anotherSession(U_PWD)
    const res = await postPassword(tokens[U_PWD]!, {
      oldPassword: 'wrong-pass',
      password: 'New-pass-456',
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as Envelope).code).toBe('AUTH_PASSWORD_INVALID')
    expect(await meStatus(otherDevice)).toBe(200)
  })

  it('旧密码正确 → 改密成功；新密码可登录、旧密码失效、其他设备会话被清', async () => {
    const otherDevice = await anotherSession(U_PWD)

    const res = await postPassword(tokens[U_PWD]!, {
      oldPassword: OLD_PASSWORD,
      password: 'New-pass-456',
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Envelope).user?.hasPassword).toBe(true)

    // 当前会话保留，其他设备会话失效
    expect(await meStatus(tokens[U_PWD]!)).toBe(200)
    expect(await meStatus(otherDevice)).toBe(401)

    const loginNew = await postLogin(PWD_USERNAME, 'New-pass-456', '10.9.0.3')
    expect(loginNew.status).toBe(200)

    const loginOld = await postLogin(PWD_USERNAME, OLD_PASSWORD, '10.9.0.4')
    expect(loginOld.status).toBe(401)
    const oldBody = (await loginOld.json()) as Envelope
    expect(oldBody.code).toBe('AUTH_INVALID')
    expect(oldBody.message).toBe(LOGIN_FAILED_MESSAGE)
  })
})
