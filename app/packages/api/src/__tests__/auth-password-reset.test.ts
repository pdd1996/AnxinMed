/**
 * P1 增补 · 未登录「忘记密码」自助找回 集成测试（100003 重置密码模板）。
 *
 * 覆盖：发码防枚举（未注册手机号返回成功但不真发）、已注册手机号用 100003 模板发码、
 *      核验 PASS 后重置密码并**清全部旧会话**、重置即登录（新 token 可用）、
 *      验证码错误 401 / 密码过短 400 / 短信服务不可用 503 / demo 模式 400。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { inArray } from 'drizzle-orm'
import { CODE_INVALID_MESSAGE } from '@anxin/shared'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { sessions, users } from '../db/schema.js'
import { hashPassword } from '../lib/auth/password.js'
import { issueSession, resetLoginAttempts } from '../services/auth.service.js'
import { DypnsError } from '../lib/sms/dypns.js'

const smsMocks = vi.hoisted(() => ({ sendSmsCode: vi.fn(), checkSmsCode: vi.fn() }))

vi.mock('../lib/sms/dypns.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sms/dypns.js')>()
  return { ...actual, sendSmsCode: smsMocks.sendSmsCode, checkSmsCode: smsMocks.checkSmsCode }
})

const U = 'auth-reset-user'
const PHONE = '13600001111'
const UNKNOWN_PHONE = '13600009999'
const OLD_PASSWORD = 'Old-pass-123'
const NEW_PASSWORD = 'New-pass-456'

const ENV_KEYS = ['DYPNS_ACCESS_KEY_ID', 'DYPNS_ACCESS_KEY_SECRET', 'DYPNS_SIGN_NAME', 'DYPNS_TEMPLATE_LOGIN'] as const
const savedEnv = new Map<string, string | undefined>()

let tokenA = ''
let tokenB = ''

type Envelope = {
  ok: boolean
  code?: string
  message?: string
  mode?: string
  token?: string
  cooldownSec?: number
  expiresInSec?: number
  signName?: string
  user?: { id: string; name: string | null; username: string | null; hasPassword?: boolean }
}

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.8.0.1' },
    body: JSON.stringify(body),
  })
}

async function cleanup(): Promise<void> {
  await db.delete(sessions).where(inArray(sessions.userId, [U]))
  await db.delete(users).where(inArray(users.id, [U]))
}

beforeAll(async () => {
  for (const key of [...ENV_KEYS, 'AUTH_MODE'] as const) savedEnv.set(key, process.env[key])
  process.env.AUTH_MODE = 'password'
  process.env.DYPNS_ACCESS_KEY_ID = 'test-ak-id'
  process.env.DYPNS_ACCESS_KEY_SECRET = 'test-ak-secret'
  process.env.DYPNS_SIGN_NAME = '测试签名'
  process.env.DYPNS_TEMPLATE_LOGIN = '100001'

  await cleanup()
  const [user] = await db
    .insert(users)
    .values({
      id: U,
      phone: PHONE,
      username: PHONE,
      phoneVerifiedAt: new Date(),
      passwordHash: await hashPassword(OLD_PASSWORD),
      passwordUpdatedAt: new Date(),
    })
    .returning()
  tokenA = await issueSession(user!)
  tokenB = await issueSession(user!)
})

afterAll(async () => {
  await cleanup()
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetLoginAttempts()
})

beforeEach(() => {
  smsMocks.sendSmsCode.mockReset()
  smsMocks.checkSmsCode.mockReset()
  resetLoginAttempts()
})

describe('POST /api/auth/password/reset-code —— 忘记密码发码', () => {
  it('未注册手机号 → 同一成功形态但不发短信（防枚举、不烧钱）', async () => {
    const res = await post('/api/auth/password/reset-code', { phone: UNKNOWN_PHONE })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope
    expect(body).toMatchObject({
      ok: true,
      mode: 'password',
      cooldownSec: 60,
      expiresInSec: 300,
      signName: '测试签名',
    })
    expect(smsMocks.sendSmsCode).not.toHaveBeenCalled()
  })

  it('已注册手机号 → 用 100003 重置密码模板发码', async () => {
    smsMocks.sendSmsCode.mockResolvedValue({ bizId: 'biz', requestId: 'req' })
    const res = await post('/api/auth/password/reset-code', { phone: PHONE })
    expect(res.status).toBe(200)
    expect(smsMocks.sendSmsCode).toHaveBeenCalledTimes(1)
    expect(smsMocks.sendSmsCode).toHaveBeenCalledWith(expect.objectContaining({ signName: '测试签名' }), {
      phone: PHONE,
      templateCode: '100003',
      outId: 'pwd-reset',
    })
  })

  it('短信服务不可用 → 503 SMS_SEND_FAILED（失败可见）', async () => {
    smsMocks.sendSmsCode.mockRejectedValue(new DypnsError('SMS_NETWORK', '网络异常'))
    const res = await post('/api/auth/password/reset-code', { phone: PHONE })
    expect(res.status).toBe(503)
    expect(((await res.json()) as Envelope).code).toBe('SMS_SEND_FAILED')
  })

  it('demo 模式 → 400 拒绝', async () => {
    process.env.AUTH_MODE = 'demo'
    try {
      const res = await post('/api/auth/password/reset-code', { phone: PHONE })
      expect(res.status).toBe(400)
      expect(((await res.json()) as Envelope).code).toBe('VALIDATION')
    } finally {
      process.env.AUTH_MODE = 'password'
    }
  })
})

describe('POST /api/auth/password/reset —— 重置密码并登录', () => {
  it('验证码错误 → 401 AUTH_CODE_INVALID，密码不变', async () => {
    smsMocks.checkSmsCode.mockResolvedValue({ passed: false, requestId: 'r' })
    const res = await post('/api/auth/password/reset', {
      phone: PHONE,
      code: '000000',
      password: NEW_PASSWORD,
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('AUTH_CODE_INVALID')
    expect(body.message).toBe(CODE_INVALID_MESSAGE)

    // 旧密码仍可登录
    const login = await post('/api/auth/login', { username: PHONE, password: OLD_PASSWORD })
    expect(login.status).toBe(200)
  })

  it('密码过短 → 400 VALIDATION（不进服务层）', async () => {
    const res = await post('/api/auth/password/reset', { phone: PHONE, code: '123456', password: 'short' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as Envelope).code).toBe('VALIDATION')
    expect(smsMocks.checkSmsCode).not.toHaveBeenCalled()
  })

  it('核验 PASS → 重置成功即登录：新密码可登录、旧会话全部失效', async () => {
    smsMocks.checkSmsCode.mockResolvedValue({ passed: true, requestId: 'r' })

    // 重置前旧 token 有效
    const before = await app.request('/api/auth/me', {
      headers: { authorization: `Bearer ${tokenA}` },
    })
    expect(before.status).toBe(200)

    const res = await post('/api/auth/password/reset', {
      phone: PHONE,
      code: '123456',
      password: NEW_PASSWORD,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope
    expect(body.ok).toBe(true)
    expect(body.user).toMatchObject({ id: U, username: PHONE, hasPassword: true })
    expect(typeof body.token).toBe('string')

    // 旧会话（两台设备）全部失效
    for (const old of [tokenA, tokenB]) {
      const me = await app.request('/api/auth/me', { headers: { authorization: `Bearer ${old}` } })
      expect(me.status).toBe(401)
    }
    // 新 token 可用
    const meNew = await app.request('/api/auth/me', {
      headers: { authorization: `Bearer ${body.token}` },
    })
    expect(meNew.status).toBe(200)

    // 新密码可登录、旧密码失效
    const loginNew = await post('/api/auth/login', { username: PHONE, password: NEW_PASSWORD })
    expect(loginNew.status).toBe(200)
    const loginOld = await post('/api/auth/login', { username: PHONE, password: OLD_PASSWORD })
    expect(loginOld.status).toBe(401)
    expect(((await loginOld.json()) as Envelope).code).toBe('AUTH_INVALID')
  })

  it('核验服务异常 → 503（不伪装成验证码错误）', async () => {
    smsMocks.checkSmsCode.mockRejectedValue(new DypnsError('SignatureDoesNotMatch', 'bad'))
    const res = await post('/api/auth/password/reset', {
      phone: PHONE,
      code: '123456',
      password: NEW_PASSWORD,
    })
    expect(res.status).toBe(503)
    expect(((await res.json()) as Envelope).code).toBe('SMS_SEND_FAILED')
  })

  it('demo 模式 → 400 拒绝', async () => {
    process.env.AUTH_MODE = 'demo'
    try {
      const res = await post('/api/auth/password/reset', {
        phone: PHONE,
        code: '123456',
        password: NEW_PASSWORD,
      })
      expect(res.status).toBe(400)
      expect(((await res.json()) as Envelope).code).toBe('VALIDATION')
    } finally {
      process.env.AUTH_MODE = 'password'
    }
  })
})
