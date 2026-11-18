/**
 * G8 增补 · 个人资料（改姓名）集成测试 —— PATCH /api/auth/me。
 *
 * 覆盖：
 * - demo 路径作用于 p-001（**改完必须还原**，其它测试文件依赖 p-001 的姓名）；
 * - password 路径只改 token 归属人，另一用户不受影响；
 * - 未登录 401（AUTH_REQUIRED / AUTH_INVALID 区分）；
 * - 姓名契约：trim、空名、超长、换行 → 400 VALIDATION，文案来自 shared；
 * - 响应绝不带 passwordHash / email / phone。
 *
 * 环境：本文件按需切换 AUTH_MODE（与 auth.test.ts 同一套约定），vitest 串行跑文件（fileParallelism=false），
 * 故 demo 段临时改名不会与其它文件的 p-001 断言互相踩。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { DISPLAY_NAME_MAX_LENGTH } from '@anxin/shared'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { sessions, users } from '../db/schema.js'
import { hashPassword } from '../lib/auth/password.js'
import { ApiError } from '../lib/http.js'
import { resetLoginAttempts, updateUserName } from '../services/auth.service.js'

const DEMO_ID = 'p-001'
const U1 = 'me-u1'
const U2 = 'me-u2'
const U1_USERNAME = 'me-tester-1'
const U2_USERNAME = 'me-tester-2'
const U1_PASSWORD = 'Me-pass-一-123'
const U2_PASSWORD = 'Me-pass-二-456'
const U1_NAME = '改名前一号'
const U2_NAME = '改名前二号'

type Envelope = {
  ok: boolean
  code?: string
  message?: string
  mode?: string
  user?: { id: string; name: string | null; username: string | null }
}

function patchMe(body: unknown, token?: string) {
  return app.request('/api/auth/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

async function loginToken(username: string, password: string): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.0.1' },
    body: JSON.stringify({ username, password }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as Envelope & { token?: string }
  expect(body.token).toBeTruthy()
  return body.token!
}

async function nameOf(userId: string): Promise<string | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return row?.name ?? null
}

// ── demo 模式（默认 AUTH_MODE 未设置 = demo）────────────────────────────────

describe('PATCH /api/auth/me · demo 路径（作用域 = p-001）', () => {
  let originalName: string | null = null

  beforeAll(async () => {
    originalName = await nameOf(DEMO_ID)
    expect(originalName).toBeTruthy()
  })

  // 每个用例都可能改名：一律在用例后还原，避免污染其它文件对 p-001 的断言。
  afterEach(async () => {
    await updateUserName(DEMO_ID, originalName!)
  })

  it('改姓名 → 200 + mode=demo + 新名；GET /me 与 DB 同步（首尾空白被 trim）', async () => {
    const res = await patchMe({ name: '  张三  ' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('demo')
    expect(body.user).toMatchObject({ id: DEMO_ID, name: '张三' })

    const me = (await (await app.request('/api/auth/me')).json()) as Envelope
    expect(me.user?.name).toBe('张三')
    expect(await nameOf(DEMO_ID)).toBe('张三')
  })

  it('恰好上限长度 → 200（边界不误杀）', async () => {
    const name = '长'.repeat(DISPLAY_NAME_MAX_LENGTH)
    const res = await patchMe({ name })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Envelope).user?.name).toBe(name)
  })

  it('空名 / 全空格 → 400 VALIDATION（不允许清空成无名患者）', async () => {
    for (const bad of ['', '   ']) {
      const res = await patchMe({ name: bad })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Envelope
      expect(body.ok).toBe(false)
      expect(body.code).toBe('VALIDATION')
      expect(body.message).toContain('请输入姓名')
    }
  })

  it('超长（上限+1）→ 400 VALIDATION', async () => {
    const res = await patchMe({ name: '超'.repeat(DISPLAY_NAME_MAX_LENGTH + 1) })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('VALIDATION')
    expect(body.message).toContain(String(DISPLAY_NAME_MAX_LENGTH))
  })

  it('含换行 → 400 VALIDATION（单行展示文本）', async () => {
    const res = await patchMe({ name: '张\n三' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as Envelope).code).toBe('VALIDATION')
  })

  it('缺 name 字段 → 400 VALIDATION', async () => {
    const res = await patchMe({})
    expect(res.status).toBe(400)
    expect(((await res.json()) as Envelope).code).toBe('VALIDATION')
  })
})

// ── password 模式（Bearer 归属）──────────────────────────────────────────────

describe('PATCH /api/auth/me · password 路径（只改 token 归属人）', () => {
  beforeAll(async () => {
    process.env.AUTH_MODE = 'password'
    resetLoginAttempts()
    await db.delete(sessions).where(inArray(sessions.userId, [U1, U2]))
    await db.delete(users).where(inArray(users.id, [U1, U2]))
    const now = new Date()
    await db.insert(users).values([
      { id: U1, name: U1_NAME, username: U1_USERNAME, passwordHash: await hashPassword(U1_PASSWORD), passwordUpdatedAt: now },
      { id: U2, name: U2_NAME, username: U2_USERNAME, passwordHash: await hashPassword(U2_PASSWORD), passwordUpdatedAt: now },
    ])
  })

  afterAll(async () => {
    await db.delete(sessions).where(inArray(sessions.userId, [U1, U2]))
    await db.delete(users).where(inArray(users.id, [U1, U2]))
    delete process.env.AUTH_MODE
    resetLoginAttempts()
  })

  it('带 token → 改本人姓名；另一用户姓名不动（多用户边界）', async () => {
    const token = await loginToken(U1_USERNAME, U1_PASSWORD)
    const res = await patchMe({ name: '一号新名' }, token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope
    expect(body.mode).toBe('password')
    expect(body.user).toMatchObject({ id: U1, name: '一号新名', username: U1_USERNAME })

    expect(await nameOf(U1)).toBe('一号新名')
    expect(await nameOf(U2)).toBe(U2_NAME)
  })

  it('改完 token 仍然有效（改姓名不踢会话）', async () => {
    const token = await loginToken(U2_USERNAME, U2_PASSWORD)
    const patched = await patchMe({ name: '二号新名' }, token)
    expect(patched.status).toBe(200)

    const me = await app.request('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
    expect(me.status).toBe(200)
    expect(((await me.json()) as Envelope).user?.name).toBe('二号新名')
  })

  it('缺 token → 401 AUTH_REQUIRED；伪造 token → 401 AUTH_INVALID', async () => {
    const noToken = await patchMe({ name: '偷偷改名' })
    expect(noToken.status).toBe(401)
    expect(((await noToken.json()) as Envelope).code).toBe('AUTH_REQUIRED')

    const fake = await patchMe({ name: '偷偷改名' }, 'not-a-real-token')
    expect(fake.status).toBe(401)
    expect(((await fake.json()) as Envelope).code).toBe('AUTH_INVALID')

    // 两次尝试都没有写库
    expect(await nameOf(U1)).toBe('一号新名')
    expect(await nameOf(U2)).toBe('二号新名')
  })

  it('响应体不含 passwordHash / password_hash / email / phone', async () => {
    const token = await loginToken(U1_USERNAME, U1_PASSWORD)
    const text = await (await patchMe({ name: '又一个名字' }, token)).text()
    expect(text).not.toContain('passwordHash')
    expect(text).not.toContain('password_hash')
    expect(text).not.toContain('email')
    expect(text).not.toContain('phone')
  })
})

// ── service 防御 ────────────────────────────────────────────────────────────

describe('updateUserName · service 防御（会话有效但用户行已被外部清理）', () => {
  it('用户不存在 → ApiError 404（不静默当成已更新）', async () => {
    await expect(updateUserName('no-such-user', '张三')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'NOT_FOUND',
    })
    await expect(updateUserName('no-such-user', '张三')).rejects.toBeInstanceOf(ApiError)
  })
})
