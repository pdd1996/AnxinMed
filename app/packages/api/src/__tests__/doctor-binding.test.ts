/**
 * specs/25 · 医生端患者绑定（演示最小闭环）集成测试。
 *
 * 覆盖：
 * - 角色闸门：患者 token 访问医生端接口 → 403 FORBIDDEN；医生 token 正常；
 * - 绑定码：6 位数字、一次性核销、过期拒绝、患者不能为自己生成码；
 * - 数据作用域：医生队列只含已授权患者；未绑定患者的摘要/时序 → 404（不泄漏存在性）；
 * - 解绑：解绑后医生立即失去可见性；
 * - demo 模式旁路：不按绑定过滤（既有 E2E 逐字不变）。
 *
 * 环境：beforeAll 切 AUTH_MODE=password；直接插测试用户 + issueSession 发 token（不经登录限流）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { AUTH_REQUIRED_MESSAGE, BIND_ALREADY_MESSAGE, BIND_CODE_INVALID_MESSAGE, BIND_DOCTOR_ONLY_MESSAGE } from '@anxin/shared'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { doctorBindCodes, doctorPatientLinks, sessions, users } from '../db/schema.js'
import { issueSession } from '../services/auth.service.js'
import type { User } from '../types.js'

const DOCTOR_ID = 'bind-test-doctor'
const PATIENT_ID = 'bind-test-patient'
const UNBOUND_PATIENT_ID = 'bind-test-patient-unbound'
const ALL_IDS = [DOCTOR_ID, PATIENT_ID, UNBOUND_PATIENT_ID]

let doctorToken = ''
let patientToken = ''
let unboundToken = ''

type Envelope = Record<string, unknown> & { ok: boolean; code?: string; message?: string }

function req(token: string | null, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

async function cleanup(): Promise<void> {
  await db.delete(doctorBindCodes).where(inArray(doctorBindCodes.doctorId, ALL_IDS))
  await db.delete(doctorPatientLinks).where(inArray(doctorPatientLinks.doctorId, ALL_IDS))
  await db.delete(doctorPatientLinks).where(inArray(doctorPatientLinks.patientId, ALL_IDS))
  await db.delete(sessions).where(inArray(sessions.userId, ALL_IDS))
  await db.delete(users).where(inArray(users.id, ALL_IDS))
}

beforeAll(async () => {
  process.env.AUTH_MODE = 'password'
  await cleanup()
  const now = new Date()
  const inserted = await db
    .insert(users)
    .values([
      { id: DOCTOR_ID, name: '测试医生', username: 'bind-test-doctor-acct', role: 'doctor' },
      { id: PATIENT_ID, name: '测试患者', username: 'bind-test-patient-acct', role: 'patient' },
      { id: UNBOUND_PATIENT_ID, name: '未绑定患者', role: 'patient' },
    ])
    .returning()
  void now
  const byId = new Map<string, User>(inserted.map((u) => [u.id, u]))
  doctorToken = await issueSession(byId.get(DOCTOR_ID)!)
  patientToken = await issueSession(byId.get(PATIENT_ID)!)
  unboundToken = await issueSession(byId.get(UNBOUND_PATIENT_ID)!)
})

afterAll(async () => {
  await cleanup()
  delete process.env.AUTH_MODE
})

describe('角色闸门（requireDoctor）', () => {
  it('无 token → 401', async () => {
    const res = await req(null, 'GET', '/api/insight/queue')
    expect(res.status).toBe(401)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('AUTH_REQUIRED')
    expect(body.message).toBe(AUTH_REQUIRED_MESSAGE)
  })

  it('患者 token 访问医生端队列 → 403 FORBIDDEN', async () => {
    const res = await req(patientToken, 'GET', '/api/insight/queue')
    expect(res.status).toBe(403)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('FORBIDDEN')
    expect(body.message).toBe(BIND_DOCTOR_ONLY_MESSAGE)
  })

  it('患者 token 生成绑定码 → 403', async () => {
    const res = await req(patientToken, 'POST', '/api/doctor/bind-code')
    expect(res.status).toBe(403)
  })

  it('医生 token 访问队列 → 200，且未绑定时患者为空', async () => {
    const res = await req(doctorToken, 'GET', '/api/insight/queue')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope & { total: number; patients: unknown[] }
    expect(body.total).toBe(0)
    expect(body.patients).toEqual([])
  })

  it('医生 token 访问患者列表 → 空列表（不返回全库患者）', async () => {
    const res = await req(doctorToken, 'GET', '/api/insight/patients')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope & { items: unknown[] }
    expect(body.items).toEqual([])
  })
})

describe('绑定码生成与核销', () => {
  let firstCode = ''

  it('医生生成绑定码 → 6 位数字 + 未来过期时间', async () => {
    const res = await req(doctorToken, 'POST', '/api/doctor/bind-code')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope & { code: string; expiresAt: string; ttlSec: number }
    expect(body.code).toMatch(/^\d{6}$/)
    expect(body.ttlSec).toBe(600)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())
    firstCode = body.code
  })

  it('医生不能核销患者绑定码（核销仅患者角色）→ 403', async () => {
    const res = await req(doctorToken, 'POST', '/api/bindings/redeem', { code: firstCode })
    expect(res.status).toBe(403)
  })

  it('患者核销 → 绑定成功，并出现在「我的医生」', async () => {
    const res = await req(patientToken, 'POST', '/api/bindings/redeem', { code: firstCode })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope & { doctor: { id: string; name: string | null } }
    expect(body.doctor.id).toBe(DOCTOR_ID)

    const list = await req(patientToken, 'GET', '/api/bindings')
    const listBody = (await list.json()) as Envelope & { doctors: Array<{ id: string }> }
    expect(listBody.doctors.map((d) => d.id)).toContain(DOCTOR_ID)
  })

  it('同一绑定码不能重复核销 → 400 绑定码无效', async () => {
    const res = await req(unboundToken, 'POST', '/api/bindings/redeem', { code: firstCode })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Envelope
    expect(body.message).toBe(BIND_CODE_INVALID_MESSAGE)
  })

  it('已绑定状态下再次核销新码 → 409 已绑定', async () => {
    const codeRes = await req(doctorToken, 'POST', '/api/doctor/bind-code')
    const { code } = (await codeRes.json()) as { code: string }
    const res = await req(patientToken, 'POST', '/api/bindings/redeem', { code })
    expect(res.status).toBe(409)
    const body = (await res.json()) as Envelope
    expect(body.message).toBe(BIND_ALREADY_MESSAGE)
  })

  it('过期绑定码 → 400 绑定码无效', async () => {
    await db.insert(doctorBindCodes).values({
      id: 'bcode-test-expired',
      code: '999999',
      doctorId: DOCTOR_ID,
      expiresAt: new Date(Date.now() - 1000),
    })
    const res = await req(unboundToken, 'POST', '/api/bindings/redeem', { code: '999999' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Envelope
    expect(body.message).toBe(BIND_CODE_INVALID_MESSAGE)
  })
})

describe('医生端数据作用域（只看到授权患者）', () => {
  it('队列只含已绑定患者，未绑定患者不出现', async () => {
    const res = await req(doctorToken, 'GET', '/api/insight/queue')
    const body = (await res.json()) as Envelope & {
      total: number
      patients: Array<{ id: string }>
    }
    expect(body.total).toBe(1)
    expect(body.patients.map((p) => p.id)).toEqual([PATIENT_ID])
  })

  it('未绑定患者的摘要 → 404（不泄漏存在性）', async () => {
    const res = await req(doctorToken, 'POST', '/api/insight/summary', { patientId: UNBOUND_PATIENT_ID })
    expect(res.status).toBe(404)
    const body = (await res.json()) as Envelope
    expect(body.code).toBe('NOT_FOUND')
  })

  it('未绑定患者的打卡时序 → 404', async () => {
    const res = await req(doctorToken, 'GET', `/api/insight/patients/${UNBOUND_PATIENT_ID}/adherence-series`)
    expect(res.status).toBe(404)
  })

  it('已绑定患者的打卡时序 → 200（空数据也是合法响应）', async () => {
    const res = await req(doctorToken, 'GET', `/api/insight/patients/${PATIENT_ID}/adherence-series`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope & { patientId: string }
    expect(body.patientId).toBe(PATIENT_ID)
  })

  it('患者维度问答对未绑定患者 → 404', async () => {
    const res = await req(doctorToken, 'POST', '/api/insight/ask', {
      question: '他最近依从性怎么样',
      patientId: UNBOUND_PATIENT_ID,
    })
    expect(res.status).toBe(404)
  })
})

describe('解绑', () => {
  it('患者解绑 → 医生队列立即变空', async () => {
    const res = await req(patientToken, 'DELETE', `/api/bindings/${DOCTOR_ID}`)
    expect(res.status).toBe(200)

    const queue = await req(doctorToken, 'GET', '/api/insight/queue')
    const body = (await queue.json()) as Envelope & { total: number }
    expect(body.total).toBe(0)

    const list = await req(patientToken, 'GET', '/api/bindings')
    const listBody = (await list.json()) as Envelope & { doctors: unknown[] }
    expect(listBody.doctors).toEqual([])
  })

  it('重复解绑 → 404 未找到绑定关系', async () => {
    const res = await req(patientToken, 'DELETE', `/api/bindings/${DOCTOR_ID}`)
    expect(res.status).toBe(404)
  })
})

describe('demo 模式旁路（既有演示与 E2E 零回归）', () => {
  it('demo 模式不按绑定过滤：队列返回全库患者', async () => {
    process.env.AUTH_MODE = 'demo'
    try {
      const res = await req(doctorToken, 'GET', '/api/insight/queue')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Envelope & { total: number }
      // 测试库 seed 了 p-001…p-008，故全量 > 0；关键是「旁路 = 不按绑定过滤」。
      expect(body.total).toBeGreaterThan(0)
    } finally {
      process.env.AUTH_MODE = 'password'
    }
  })
})

// 防未使用告警：eq 在后续扩展断言时复用。
void eq
