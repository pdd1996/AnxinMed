/**
 * P1 手机号验证码登录/注册集成测试（阿里云短信认证 provider 以 mock 替身，不打真实短信）。
 *
 * 覆盖：发码成功/入参校验/服务商频控/配置缺失/demo 模式拒绝；
 *      核验失败 401、首登自动建号 created=true、二次登录 created=false、
 *      会话可用（/me、业务路由）、本地发码冷却 429、响应不泄漏手机号。
 *
 * 环境：beforeAll 切 AUTH_MODE=password 并注入测试 DYPNS_*；其余测试文件的 demo 基线不受影响
 * （vitest 按文件隔离进程）。真实支付链路（可达性/送达）由 `pnpm sms:smoke` 手动验收。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { inArray, eq } from 'drizzle-orm'
import {
  CODE_INVALID_MESSAGE,
  SMS_NOT_CONFIGURED_MESSAGE,
  SMS_SEND_FAILED_MESSAGE,
  SMS_TOO_FREQUENT_MESSAGE,
} from '@anxin/shared'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { sessions, users } from '../db/schema.js'
import { resetSmsRateLimits } from '../lib/auth/sms-rate-limit.js'
import { DypnsError } from '../lib/sms/dypns.js'

const smsMocks = vi.hoisted(() => ({ sendSmsCode: vi.fn(), checkSmsCode: vi.fn() }))

vi.mock('../lib/sms/dypns.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sms/dypns.js')>()
  return { ...actual, sendSmsCode: smsMocks.sendSmsCode, checkSmsCode: smsMocks.checkSmsCode }
})

const PHONE = '13900001111'
const PHONE2 = '13900002222'
const SIGN_NAME = '测试签名'

const ENV_KEYS = [
  'DYPNS_ACCESS_KEY_ID',
  'DYPNS_ACCESS_KEY_SECRET',
  'DYPNS_SIGN_NAME',
  'DYPNS_TEMPLATE_LOGIN',
] as const
const savedEnv = new Map<string, string | undefined>()

type Envelope = {
  ok: boolean
  code?: string
  message?: string
  token?: string
  created?: boolean
  mode?: string
  cooldownSec?: number
  expiresInSec?: number
  signName?: string
  user?: { id: string; name: string | null; username: string | null }
  retryAfterSec?: number
}

function postJson(path: string, body: unknown, ip = '10.1.0.1') {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

function authed(token: string) {
  return { authorization: `Bearer ${token}` }
}

/** 清理本文件建的用户与其会话（按手机号反查，防断言失败残留）。 */
async function cleanupPhoneUsers(): Promise<void> {
  const rows = await db.select().from(users).where(inArray(users.phone, [PHONE, PHONE2]))
  const ids = rows.map((r) => r.id)
  if (ids.length > 0) {
    await db.delete(sessions).where(inArray(sessions.userId, ids))
    await db.delete(users).where(inArray(users.id, ids))
  }
}

beforeAll(async () => {
  savedEnv.set('AUTH_MODE', process.env.AUTH_MODE)
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key])

  process.env.AUTH_MODE = 'password'
  process.env.DYPNS_ACCESS_KEY_ID = 'test-ak-id'
  process.env.DYPNS_ACCESS_KEY_SECRET = 'test-ak-secret'
  process.env.DYPNS_SIGN_NAME = SIGN_NAME
  process.env.DYPNS_TEMPLATE_LOGIN = '100001'

  await cleanupPhoneUsers()
})

afterAll(async () => {
  await cleanupPhoneUsers()
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetSmsRateLimits()
})

beforeEach(() => {
  smsMocks.sendSmsCode.mockReset()
  smsMocks.checkSmsCode.mockReset()
  resetSmsRateLimits()
})

describe('POST /api/auth/phone/send-code —— 发送验证码', () => {
  it('手机号合法 → 200 + mode/冷却/有效期/签名；provider 收到该手机号', async () => {
    smsMocks.sendSmsCode.mockResolvedValue({ bizId: 'biz-test', requestId: 'req-test' })

    const res = await postJson('/api/auth/phone/send-code', { phone: PHONE })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope
    expect(body).toMatchObject({
      ok: true,
      mode: 'password',
      cooldownSec: 60,
      expiresInSec: 300,
      signName: SIGN_NAME,
    })
    expect(smsMocks.sendSmsCode).toHaveBeenCalledTimes(1)
    expect(smsMocks.sendSmsCode).toHaveBeenCalledWith(
      expect.objectContaining({ signName: SIGN_NAME }),
      { phone: PHONE },
    )
    // 响应里不回显手机号/验证码
    expect(JSON.stringify(body)).not.toContain(PHONE)
  })

  it('手机号非法 → 400 VALIDATION，不调用短信服务（不花钱、不打接口）', async () => {
    const res = await postJson('/api/auth/phone/send-code', { phone: '12345' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as Envelope).code).toBe('VALIDATION')
    expect(smsMocks.sendSmsCode).not.toHaveBeenCalled()
  })

  it('服务商频控（isv.BUSINESS_LIMIT_CONTROL）→ 429 SMS_LIMITED + 可读文案', async () => {
    smsMocks.sendSmsCode.mockRejectedValue(
      new DypnsError('isv.BUSINESS_LIMIT_CONTROL', '触发号码天级流控'),
    )
    const res = await postJson('/api/auth/phone/send-code', { phone: PHONE })
    expect(res.status).toBe(429)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('SMS_LIMITED')
    expect(body.message).toBe(SMS_TOO_FREQUENT_MESSAGE)
  })

  it('服务商不可用（网络异常）→ 503 SMS_SEND_FAILED（失败可见，不静默假装已发送）', async () => {
    smsMocks.sendSmsCode.mockRejectedValue(new DypnsError('SMS_NETWORK', '短信服务网络异常'))
    const res = await postJson('/api/auth/phone/send-code', { phone: PHONE })
    expect(res.status).toBe(503)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('SMS_SEND_FAILED')
    expect(body.message).toBe(SMS_SEND_FAILED_MESSAGE)
  })

  it('未配置 DYPNS_* → 503 SMS_NOT_CONFIGURED（部署缺配置明确报错）', async () => {
    for (const key of ENV_KEYS) delete process.env[key]
    try {
      const res = await postJson('/api/auth/phone/send-code', { phone: PHONE })
      expect(res.status).toBe(503)
      const body = (await res.json()) as Envelope
      expect(body.code).toBe('SMS_NOT_CONFIGURED')
      expect(body.message).toBe(SMS_NOT_CONFIGURED_MESSAGE)
    } finally {
      process.env.DYPNS_ACCESS_KEY_ID = 'test-ak-id'
      process.env.DYPNS_ACCESS_KEY_SECRET = 'test-ak-secret'
      process.env.DYPNS_SIGN_NAME = SIGN_NAME
      process.env.DYPNS_TEMPLATE_LOGIN = '100001'
    }
  })

  it('本地冷却（RL_FORCE=1）：同号 60 秒内第二次发码 → 429 SMS_LIMITED + retryAfterSec', async () => {
    process.env.RL_FORCE = '1'
    resetSmsRateLimits()
    try {
      smsMocks.sendSmsCode.mockResolvedValue({ bizId: 'biz-test', requestId: 'req-test' })
      const first = await postJson('/api/auth/phone/send-code', { phone: PHONE2 }, '10.1.0.9')
      expect(first.status).toBe(200)

      const second = await postJson('/api/auth/phone/send-code', { phone: PHONE2 }, '10.1.0.9')
      expect(second.status).toBe(429)
      const body = (await second.json()) as Envelope
      expect(body.code).toBe('SMS_LIMITED')
      expect(body.message).toBe(SMS_TOO_FREQUENT_MESSAGE)
      expect(body.retryAfterSec).toBeGreaterThan(0)
      // 第二次被本地拦下，没有再打短信服务（省钱且不触发供应商频控）
      expect(smsMocks.sendSmsCode).toHaveBeenCalledTimes(1)
    } finally {
      delete process.env.RL_FORCE
      resetSmsRateLimits()
    }
  })
})

describe('POST /api/auth/phone/login —— 验证码即注册', () => {
  it('验证码错误 → 401 AUTH_CODE_INVALID（统一文案，不区分没发过/过期）', async () => {
    smsMocks.checkSmsCode.mockResolvedValue({ passed: false, requestId: 'req-x' })
    const res = await postJson('/api/auth/phone/login', { phone: PHONE, code: '000000' })
    expect(res.status).toBe(401)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('AUTH_CODE_INVALID')
    expect(body.message).toBe(CODE_INVALID_MESSAGE)
  })

  it('首次登录 → 自动建号：created=true、token 可访问 /me 与业务路由、响应不含手机号', async () => {
    smsMocks.checkSmsCode.mockResolvedValue({ passed: true, requestId: 'req-pass' })

    const res = await postJson('/api/auth/phone/login', { phone: PHONE, code: '123456' })
    expect(res.status).toBe(200)
    const text = await res.text()
    const body = JSON.parse(text) as Envelope
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('password')
    expect(body.created).toBe(true)
    expect(body.user?.id).toMatch(/^u-/)
    expect(body.user?.username).toBeNull()
    expect(typeof body.token).toBe('string')
    expect(text).not.toContain(PHONE)
    expect(text).not.toContain('"phone"')

    // 会话可用：/me 解析出同一用户；业务路由 200
    const me = await app.request('/api/auth/me', { headers: authed(body.token!) })
    expect(me.status).toBe(200)
    expect(((await me.json()) as Envelope).user?.id).toBe(body.user!.id)
    const drugs = await app.request('/api/drugs', { headers: authed(body.token!) })
    expect(drugs.status).toBe(200)

    // 库内该用户 phone 已落库、phoneVerifiedAt 已记录
    const [row] = await db.select().from(users).where(eq(users.id, body.user!.id))
    expect(row?.phone).toBe(PHONE)
    expect(row?.phoneVerifiedAt).toBeTruthy()

    // 二次登录 → 不重复建号
    const again = await postJson('/api/auth/phone/login', { phone: PHONE, code: '654321' })
    expect(again.status).toBe(200)
    const againBody = (await again.json()) as Envelope
    expect(againBody.created).toBe(false)
    expect(againBody.user?.id).toBe(body.user!.id)
  })

  it('核验服务不可用 → 503 SMS_SEND_FAILED（不把异常伪装成验证码错误）', async () => {
    smsMocks.checkSmsCode.mockRejectedValue(new DypnsError('SignatureDoesNotMatch', 'bad sign'))
    const res = await postJson('/api/auth/phone/login', { phone: PHONE, code: '123456' })
    expect(res.status).toBe(503)
    expect(((await res.json()) as Envelope).code).toBe('SMS_SEND_FAILED')
  })

  it('验证码格式非法 → 400 VALIDATION（不进服务层）', async () => {
    const res = await postJson('/api/auth/phone/login', { phone: PHONE, code: 'abc' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as Envelope).code).toBe('VALIDATION')
    expect(smsMocks.checkSmsCode).not.toHaveBeenCalled()
  })
})

describe('demo 模式拒绝（手机号接口只在 password 模式可用）', () => {
  it('AUTH_MODE=demo → 发码与验证码登录均 400，且不触发短信服务', async () => {
    process.env.AUTH_MODE = 'demo'
    try {
      const send = await postJson('/api/auth/phone/send-code', { phone: PHONE })
      expect(send.status).toBe(400)
      expect(((await send.json()) as Envelope).code).toBe('VALIDATION')

      const loginRes = await postJson('/api/auth/phone/login', { phone: PHONE, code: '123456' })
      expect(loginRes.status).toBe(400)
      expect(((await loginRes.json()) as Envelope).code).toBe('VALIDATION')

      expect(smsMocks.sendSmsCode).not.toHaveBeenCalled()
      expect(smsMocks.checkSmsCode).not.toHaveBeenCalled()
    } finally {
      process.env.AUTH_MODE = 'password'
    }
  })
})
