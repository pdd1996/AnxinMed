/**
 * G7 认证集成测试：账号密码登录 / 会话 token / 401 语义 / 失败限流 / 多用户隔离。
 *
 * 环境说明：本文件在 beforeAll 把 AUTH_MODE 切到 password；vitest 默认按文件隔离进程，
 * 其余测试文件的 demo 基线（p-001 旁路）不受影响；resolveUser 每请求读 env，故切换即时生效。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import {
  AUTH_INVALID_MESSAGE,
  AUTH_REQUIRED_MESSAGE,
  LOGIN_FAILED_MESSAGE,
  LOGIN_LOCKED_MESSAGE,
} from '@anxin/shared'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { sessions, users } from '../db/schema.js'
import { hashPassword } from '../lib/auth/password.js'
import { hashToken, resetLoginAttempts } from '../services/auth.service.js'

const U1 = 'auth-u1'
const U2 = 'auth-u2'
const U1_NAME = '认证测试一号'
const U2_NAME = '认证测试二号'
const U1_USERNAME = 'auth-tester-1'
const U2_USERNAME = 'auth-tester-2'
const U1_PASSWORD = 'Auth-pass-一-123'
const U2_PASSWORD = 'Auth-pass-二-456'

type Envelope = { ok: boolean; code?: string; message?: string; token?: string; user?: Record<string, unknown>; mode?: string }

async function postLogin(username: string, password: string, ip = '10.0.0.1') {
  return app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username, password }),
  })
}

async function tokenFor(username: string, password: string, ip = '10.0.0.1'): Promise<string> {
  const res = await postLogin(username, password, ip)
  expect(res.status).toBe(200)
  const body = (await res.json()) as Envelope
  expect(body.token).toBeTruthy()
  return body.token!
}

function authed(token: string, headers: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, ...headers }
}

beforeAll(async () => {
  process.env.AUTH_MODE = 'password'
  resetLoginAttempts()
  await db.delete(sessions).where(inArray(sessions.userId, [U1, U2]))
  await db.delete(users).where(inArray(users.id, [U1, U2]))
  const now = new Date()
  await db.insert(users).values([
    {
      id: U1,
      name: U1_NAME,
      username: U1_USERNAME,
      passwordHash: await hashPassword(U1_PASSWORD),
      passwordUpdatedAt: now,
    },
    {
      id: U2,
      name: U2_NAME,
      username: U2_USERNAME,
      passwordHash: await hashPassword(U2_PASSWORD),
      passwordUpdatedAt: now,
    },
  ])
})

afterAll(async () => {
  await db.delete(sessions).where(inArray(sessions.userId, [U1, U2]))
  await db.delete(users).where(inArray(users.id, [U1, U2]))
  delete process.env.AUTH_MODE
  resetLoginAttempts()
})

beforeEach(() => {
  resetLoginAttempts()
})

describe('POST /api/auth/login —— 账号密码登录', () => {
  it('正确凭据 → 200 + token + 安全用户对象（不含 passwordHash/email/phone）', async () => {
    const res = await postLogin(U1_USERNAME, U1_PASSWORD)
    expect(res.status).toBe(200)
    const text = await res.text()
    const body = JSON.parse(text) as Envelope
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('password')
    expect(typeof body.token).toBe('string')
    expect(body.token!.length).toBeGreaterThanOrEqual(40)
    expect(body.user).toMatchObject({ id: U1, name: U1_NAME, username: U1_USERNAME })
    expect(text).not.toContain('passwordHash')
    expect(text).not.toContain('password_hash')
  })

  it('密码错误 → 401 AUTH_INVALID（统一文案，不泄漏账号是否存在）', async () => {
    const res = await postLogin(U1_USERNAME, 'wrong-password')
    expect(res.status).toBe(401)
    const body = (await res.json()) as Envelope
    expect(body.ok).toBe(false)
    expect(body.code).toBe('AUTH_INVALID')
    expect(body.message).toBe(LOGIN_FAILED_MESSAGE)
  })

  it('账号不存在 → 401 AUTH_INVALID 与密码错误同文案', async () => {
    const res = await postLogin('no-such-account', 'whatever')
    expect(res.status).toBe(401)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('AUTH_INVALID')
    expect(body.message).toBe(LOGIN_FAILED_MESSAGE)
  })

  it('未开通登录的 seed 用户（p-001 无凭据）→ 401 AUTH_INVALID', async () => {
    const res = await postLogin('p-001', 'whatever')
    expect(res.status).toBe(401)
    expect(((await res.json()) as Envelope).code).toBe('AUTH_INVALID')
  })

  it('入参校验：缺 password → 400 VALIDATION', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: U1_USERNAME }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as Envelope).code).toBe('VALIDATION')
  })

  it('用户名两端空白被 trim 后仍能登录（契约 LoginRequestSchema 行为）', async () => {
    const res = await postLogin(`  ${U1_USERNAME}  `, U1_PASSWORD)
    expect(res.status).toBe(200)
  })
})

describe('GET /api/auth/me 与 Bearer 语义', () => {
  it('带 token → 200 + 当前用户', async () => {
    const token = await tokenFor(U1_USERNAME, U1_PASSWORD)
    const res = await app.request('/api/auth/me', { headers: authed(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope
    expect(body.mode).toBe('password')
    expect(body.user).toMatchObject({ id: U1, username: U1_USERNAME })
  })

  it('缺 token → 401 AUTH_REQUIRED；伪造 token → 401 AUTH_INVALID', async () => {
    const noToken = await app.request('/api/auth/me')
    expect(noToken.status).toBe(401)
    expect(((await noToken.json()) as Envelope).code).toBe('AUTH_REQUIRED')

    const fake = await app.request('/api/auth/me', { headers: { authorization: 'Bearer not-a-real-token' } })
    expect(fake.status).toBe(401)
    const body = (await fake.json()) as Envelope
    expect(body.code).toBe('AUTH_INVALID')
    expect(body.message).toBe(AUTH_INVALID_MESSAGE)
  })

  it('业务路由同样受保护：无 token 的 /api/drugs → 401 AUTH_REQUIRED', async () => {
    const res = await app.request('/api/drugs')
    expect(res.status).toBe(401)
    expect(((await res.json()) as Envelope).code).toBe('AUTH_REQUIRED')
    expect(AUTH_REQUIRED_MESSAGE).toBe('请先登录')
  })

  it('Authorization 头大小写不敏感（bearer xxx）', async () => {
    const token = await tokenFor(U1_USERNAME, U1_PASSWORD)
    const res = await app.request('/api/auth/me', {
      headers: { authorization: `bearer ${token}` },
    })
    expect(res.status).toBe(200)
  })
})

describe('多用户隔离（真实 HTTP 链路 + token 归属）', () => {
  it('u1 建的药，u2 列表不可见、按 id 直取 404；u1 自己可见', async () => {
    const u1 = await tokenFor(U1_USERNAME, U1_PASSWORD, '10.0.0.11')
    const u2 = await tokenFor(U2_USERNAME, U2_PASSWORD, '10.0.0.12')

    const created = await app.request('/api/drugs', {
      method: 'POST',
      headers: authed(u1, { 'content-type': 'application/json' }),
      body: JSON.stringify({ genericName: '认证隔离测试药', specification: '10mg' }),
    })
    expect(created.status).toBe(201)
    const drugId = ((await created.json()) as { drug: { id: string } }).drug.id

    try {
      const u1List = (await (await app.request('/api/drugs', { headers: authed(u1) })).json()) as {
        items: { id: string }[]
      }
      expect(u1List.items.some((d) => d.id === drugId)).toBe(true)

      const u2List = (await (await app.request('/api/drugs', { headers: authed(u2) })).json()) as {
        items: { id: string }[]
      }
      expect(u2List.items.some((d) => d.id === drugId)).toBe(false)

      const u2Direct = await app.request(`/api/drugs/${drugId}`, { headers: authed(u2) })
      expect(u2Direct.status).toBe(404)
    } finally {
      await app.request(`/api/drugs/${drugId}`, { method: 'DELETE', headers: authed(u1) })
    }
  })
})

describe('登出与会话失效', () => {
  it('POST /api/auth/logout 后原 token 失效（AUTH_INVALID）', async () => {
    const token = await tokenFor(U1_USERNAME, U1_PASSWORD, '10.0.0.21')
    const logout = await app.request('/api/auth/logout', { method: 'POST', headers: authed(token) })
    expect(logout.status).toBe(200)

    const me = await app.request('/api/auth/me', { headers: authed(token) })
    expect(me.status).toBe(401)
    expect(((await me.json()) as Envelope).code).toBe('AUTH_INVALID')
  })

  it('过期 session → 401 AUTH_INVALID，且过期行被清理', async () => {
    const token = 'expired-token-for-auth-test'
    await db.insert(sessions).values({
      id: 'sess-auth-expired',
      userId: U1,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() - 60_000),
    })

    const me = await app.request('/api/auth/me', { headers: authed(token) })
    expect(me.status).toBe(401)
    expect(((await me.json()) as Envelope).code).toBe('AUTH_INVALID')

    const left = await db.select().from(sessions).where(inArray(sessions.id, ['sess-auth-expired']))
    expect(left).toHaveLength(0)
  })

  it('logout 对无效/缺失 token 幂等（200，不报错）', async () => {
    const noToken = await app.request('/api/auth/logout', { method: 'POST' })
    expect(noToken.status).toBe(200)
    const badToken = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { authorization: 'Bearer nothing' },
    })
    expect(badToken.status).toBe(200)
  })
})

describe('登录失败限流（5 次/15 分钟，按 IP+账号）', () => {
  it('同 IP 连续 5 次失败 → 第 5 次起 429 AUTH_LOCKED；锁定后正确密码也 429', async () => {
    const username = U2_USERNAME
    for (let i = 0; i < 4; i += 1) {
      const res = await postLogin(username, 'wrong', '10.0.0.31')
      expect(res.status).toBe(401)
    }
    const fifth = await postLogin(username, 'wrong', '10.0.0.31')
    expect(fifth.status).toBe(429)
    const fifthBody = (await fifth.json()) as Envelope
    expect(fifthBody.code).toBe('AUTH_LOCKED')
    expect(fifthBody.message).toBe(LOGIN_LOCKED_MESSAGE)

    const correctButLocked = await postLogin(username, U2_PASSWORD, '10.0.0.31')
    expect(correctButLocked.status).toBe(429)

    // 换 IP 不受同一锁影响（锁键 = IP|账号）
    const otherIp = await postLogin(username, U2_PASSWORD, '10.0.0.32')
    expect(otherIp.status).toBe(200)
  })
})

describe('demo 旁路（AUTH_MODE=demo）', () => {
  it('/api/auth/me 无 token 返回 mode=demo + p-001；业务路由无需 token', async () => {
    process.env.AUTH_MODE = 'demo'
    try {
      const me = await app.request('/api/auth/me')
      expect(me.status).toBe(200)
      const body = (await me.json()) as Envelope
      expect(body.mode).toBe('demo')
      expect(body.user).toMatchObject({ id: 'p-001' })

      const drugs = await app.request('/api/drugs')
      expect(drugs.status).toBe(200)
    } finally {
      process.env.AUTH_MODE = 'password'
    }
  })

  it('demo 模式下 login 明确拒绝（400），不静默发 token', async () => {
    process.env.AUTH_MODE = 'demo'
    try {
      const res = await postLogin(U1_USERNAME, U1_PASSWORD)
      expect(res.status).toBe(400)
      expect(((await res.json()) as Envelope).code).toBe('VALIDATION')
    } finally {
      process.env.AUTH_MODE = 'password'
    }
  })
})

describe('AUTH_MODE 配置非法 → 500 可见失败（不静默退化到 demo）', () => {
  it('AUTH_MODE=foo → 受保护路由 500 INTERNAL，message 指出配置非法', async () => {
    process.env.AUTH_MODE = 'foo'
    try {
      const res = await app.request('/api/drugs')
      expect(res.status).toBe(500)
      const body = (await res.json()) as Envelope
      expect(body.ok).toBe(false)
      expect(body.code).toBe('INTERNAL')
      expect(body.message).toContain('AUTH_MODE')
    } finally {
      process.env.AUTH_MODE = 'password'
    }
  })
})
