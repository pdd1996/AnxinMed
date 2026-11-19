/**
 * specs/25 · 医生端患者绑定（演示最小闭环）集成测试。
 *
 * 覆盖：
 * - 角色闸门：患者 token 访问医生端接口 → 403 FORBIDDEN；医生 token 正常；
 * - 绑定码：6 位数字、一次性核销、过期拒绝、患者不能为自己生成码；
 * - 数据作用域：医生队列只含已授权患者；未绑定患者的摘要/时序 → 404（不泄漏存在性）；
 * - 解绑：解绑后医生立即失去可见性；
 * - 核销限流（specs/25 §5 补强）：患者维度 6 次尝试 → 429 BIND_LOCKED；成功核销清空计数；
 *   IP 维度同 IP 多患者超限 → 429（RL_FORCE=1 开启限流）；
 * - 绑定安全审计：生成/拒绝/成功/解绑均落 JSONL，且绝不落绑定码明文；
 * - demo 模式旁路：不按绑定过滤（既有 E2E 逐字不变）。
 *
 * 环境：beforeAll 切 AUTH_MODE=password；直接插测试用户 + issueSession 发 token（不经登录限流）。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import {
  AUTH_REQUIRED_MESSAGE,
  BIND_ALREADY_MESSAGE,
  BIND_CODE_INVALID_MESSAGE,
  BIND_CODE_LOCKED_MESSAGE,
  BIND_DOCTOR_ONLY_MESSAGE,
} from '@anxin/shared'
import { app } from '../app.js'
import { db } from '../db/client.js'
import { doctorBindCodes, doctorPatientLinks, sessions, users } from '../db/schema.js'
import { resetBindRateLimits } from '../lib/bind-rate-limit.js'
import { resetBindAuditForTests } from '../lib/observability/bind-audit.js'
import { issueSession } from '../services/auth.service.js'
import type { User } from '../types.js'

const DOCTOR_ID = 'bind-test-doctor'
const PATIENT_ID = 'bind-test-patient'
const UNBOUND_PATIENT_ID = 'bind-test-patient-unbound'
// 限流/审计用例专用患者（各自独立计数，避免与既有流程用例互相干扰）。
const RATE_PATIENT_1 = 'bind-test-rate-1'
const RATE_PATIENT_2 = 'bind-test-rate-2'
const RATE_PATIENT_3 = 'bind-test-rate-3'
const ALL_IDS = [DOCTOR_ID, PATIENT_ID, UNBOUND_PATIENT_ID, RATE_PATIENT_1, RATE_PATIENT_2, RATE_PATIENT_3]

let doctorToken = ''
let patientToken = ''
let unboundToken = ''
let ratePatient1Token = ''
let ratePatient2Token = ''
let ratePatient3Token = ''

/** 审计日志临时目录（不污染仓库 logs/；afterAll 清理）。 */
let auditLogDir = ''

type Envelope = Record<string, unknown> & { ok: boolean; code?: string; message?: string }

function req(token: string | null, method: string, path: string, body?: unknown, ip?: string) {
  return app.request(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

/** 读临时目录下全部绑定审计 JSONL（按行解析；测试环境 LOG_DIR 指向临时目录）。 */
function readAuditEntries(): Array<Record<string, unknown>> {
  const files = readdirSync(auditLogDir).filter((name) => name.startsWith('bind-audit-'))
  return files.flatMap((name) =>
    readFileSync(join(auditLogDir, name), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  )
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
  // 限流默认在 test 环境关闭；本文件显式开启以验证 429（新用例会 reset，既有流程用例尝试次数远低于阈值）。
  process.env.RL_FORCE = '1'
  auditLogDir = mkdtempSync(join(tmpdir(), 'anxin-bind-audit-'))
  process.env.LOG_DIR = auditLogDir
  resetBindAuditForTests()
  await cleanup()
  const now = new Date()
  const inserted = await db
    .insert(users)
    .values([
      { id: DOCTOR_ID, name: '测试医生', username: 'bind-test-doctor-acct', role: 'doctor' },
      { id: PATIENT_ID, name: '测试患者', username: 'bind-test-patient-acct', role: 'patient' },
      { id: UNBOUND_PATIENT_ID, name: '未绑定患者', role: 'patient' },
      { id: RATE_PATIENT_1, name: '限流患者一', role: 'patient' },
      { id: RATE_PATIENT_2, name: '限流患者二', role: 'patient' },
      { id: RATE_PATIENT_3, name: '限流患者三', role: 'patient' },
    ])
    .returning()
  void now
  const byId = new Map<string, User>(inserted.map((u) => [u.id, u]))
  doctorToken = await issueSession(byId.get(DOCTOR_ID)!)
  patientToken = await issueSession(byId.get(PATIENT_ID)!)
  unboundToken = await issueSession(byId.get(UNBOUND_PATIENT_ID)!)
  ratePatient1Token = await issueSession(byId.get(RATE_PATIENT_1)!)
  ratePatient2Token = await issueSession(byId.get(RATE_PATIENT_2)!)
  ratePatient3Token = await issueSession(byId.get(RATE_PATIENT_3)!)
})

afterAll(async () => {
  await cleanup()
  delete process.env.AUTH_MODE
  delete process.env.RL_FORCE
  delete process.env.LOG_DIR
  delete process.env.BIND_REDEEM_PER_10MIN
  delete process.env.BIND_REDEEM_IP_PER_10MIN
  if (auditLogDir) rmSync(auditLogDir, { recursive: true, force: true })
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

// ---------------------------------------------------------------------------
// 核销限流（specs/25 §5 补强）：患者账号 + IP 双维度滑动窗口
// ---------------------------------------------------------------------------
describe('核销限流（患者 + IP 双维度）', () => {
  const IP_PATIENT_1 = '198.51.100.11'
  const IP_PATIENT_2 = '198.51.100.12'
  const IP_SHARED = '198.51.100.99'

  beforeEach(() => {
    resetBindRateLimits()
  })

  afterEach(() => {
    delete process.env.BIND_REDEEM_PER_10MIN
    delete process.env.BIND_REDEEM_IP_PER_10MIN
    resetBindRateLimits()
  })

  it('同一患者连续 6 次尝试 → 第 6 次 429 BIND_LOCKED（带 retryAfterSec 与可读文案）', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await req(ratePatient1Token, 'POST', '/api/bindings/redeem', { code: '000001' }, IP_PATIENT_1)
      expect(res.status).toBe(400)
      expect(((await res.json()) as Envelope).message).toBe(BIND_CODE_INVALID_MESSAGE)
    }
    const sixth = await req(ratePatient1Token, 'POST', '/api/bindings/redeem', { code: '000001' }, IP_PATIENT_1)
    expect(sixth.status).toBe(429)
    const body = (await sixth.json()) as Envelope & { retryAfterSec?: number }
    expect(body.code).toBe('BIND_LOCKED')
    expect(body.message).toContain(BIND_CODE_LOCKED_MESSAGE)
    expect(body.message).toContain('分钟后可重试')
    expect(body.retryAfterSec).toBeGreaterThan(0)
  })

  it('两个维度互不串扰：患者 1 被锁不影响另一患者从同一 IP 继续尝试', async () => {
    for (let i = 0; i < 5; i++) {
      await req(ratePatient1Token, 'POST', '/api/bindings/redeem', { code: '000001' }, IP_SHARED)
    }
    const locked = await req(ratePatient1Token, 'POST', '/api/bindings/redeem', { code: '000001' }, IP_SHARED)
    expect(locked.status).toBe(429)

    // 同 IP 第 6 次仍低于 IP 配额（20），另一患者可按普通「码无效」失败，而不是被患者维度连坐。
    const other = await req(ratePatient3Token, 'POST', '/api/bindings/redeem', { code: '000001' }, IP_SHARED)
    expect(other.status).toBe(400)
  })

  it('成功核销后清空该患者计数：4 次失败 → 成功 → 再失败 4 次仍是 400（不累计到锁定）', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await req(ratePatient2Token, 'POST', '/api/bindings/redeem', { code: '000002' }, IP_PATIENT_2)
      expect(res.status).toBe(400)
    }

    const codeRes = await req(doctorToken, 'POST', '/api/doctor/bind-code')
    const { code } = (await codeRes.json()) as { code: string }
    const ok = await req(ratePatient2Token, 'POST', '/api/bindings/redeem', { code }, IP_PATIENT_2)
    expect(ok.status).toBe(200)

    // 若成功未清空计数，累计 5 次后第 6 次即 429；这里必须仍返回普通 400。
    for (let i = 0; i < 4; i++) {
      const res = await req(ratePatient2Token, 'POST', '/api/bindings/redeem', { code: '000003' }, IP_PATIENT_2)
      expect(res.status).toBe(400)
    }
  })

  it('IP 维度：同 IP 的多名患者合计超限 → 429（BIND_REDEEM_IP_PER_10MIN 可调）', async () => {
    process.env.BIND_REDEEM_IP_PER_10MIN = '2'
    resetBindRateLimits()

    const first = await req(ratePatient1Token, 'POST', '/api/bindings/redeem', { code: '000004' }, IP_SHARED)
    expect(first.status).toBe(400)
    const second = await req(ratePatient2Token, 'POST', '/api/bindings/redeem', { code: '000004' }, IP_SHARED)
    expect(second.status).toBe(400)
    const third = await req(ratePatient3Token, 'POST', '/api/bindings/redeem', { code: '000004' }, IP_SHARED)
    expect(third.status).toBe(429)
    const body = (await third.json()) as Envelope
    expect(body.code).toBe('BIND_LOCKED')
  })
})

// ---------------------------------------------------------------------------
// 绑定安全审计（JSONL）：谁在何时生成/绑定/解绑、核销为什么失败；绝不落码明文
// ---------------------------------------------------------------------------
describe('绑定安全审计（JSONL）', () => {
  it('生成 / 拒绝 / 成功 / 解绑四类动作均落盘，且不含绑定码明文', async () => {
    resetBindRateLimits()
    const ip = '198.51.100.13'

    const codeRes = await req(doctorToken, 'POST', '/api/doctor/bind-code')
    const { code } = (await codeRes.json()) as { code: string }

    // 先失败一次（码无效）→ 再成功核销 → 解绑
    const rejected = await req(ratePatient3Token, 'POST', '/api/bindings/redeem', { code: '000005' }, ip)
    expect(rejected.status).toBe(400)
    const bound = await req(ratePatient3Token, 'POST', '/api/bindings/redeem', { code }, ip)
    expect(bound.status).toBe(200)
    const unbound = await req(ratePatient3Token, 'DELETE', `/api/bindings/${DOCTOR_ID}`)
    expect(unbound.status).toBe(200)

    const entries = readAuditEntries()
    const actions = new Set(entries.map((entry) => entry.action))
    expect(actions.has('bind_code_generated')).toBe(true)
    expect(actions.has('redeem_rejected')).toBe(true)
    expect(actions.has('bind_succeeded')).toBe(true)
    expect(actions.has('bind_revoked')).toBe(true)

    // 每条都是结构化记录：目标 id 可见，但没有 code 字段、任何值都不等于绑定码明文。
    for (const entry of entries) {
      expect(entry.event).toBe('bind_audit')
      expect(typeof entry.actorUserId).toBe('string')
      expect(entry).not.toHaveProperty('code')
      for (const value of Object.values(entry)) {
        expect(value).not.toBe(code)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 医生端解除患者（specs/25 增补 · 撤销权对称化）
// ---------------------------------------------------------------------------
describe('医生端解除患者（撤销权对称化）', () => {
  it('患者 token 调医生端解除 → 403（角色闸门先于绑定判定）', async () => {
    const res = await req(patientToken, 'DELETE', `/api/doctor/bindings/${PATIENT_ID}`)
    expect(res.status).toBe(403)
  })

  it('医生解除已绑定患者 → 队列/患者端同步消失；重复解除 404；审计记 doctor_unbind', async () => {
    resetBindRateLimits()
    resetBindAuditForTests()

    const codeRes = await req(doctorToken, 'POST', '/api/doctor/bind-code')
    const { code } = (await codeRes.json()) as { code: string }
    const bound = await req(ratePatient1Token, 'POST', '/api/bindings/redeem', { code }, '198.51.100.31')
    expect(bound.status).toBe(200)

    const before = await req(doctorToken, 'GET', '/api/insight/queue')
    const beforeBody = (await before.json()) as Envelope & { patients: Array<{ id: string }> }
    expect(beforeBody.patients.map((p) => p.id)).toContain(RATE_PATIENT_1)

    const unbound = await req(doctorToken, 'DELETE', `/api/doctor/bindings/${RATE_PATIENT_1}`)
    expect(unbound.status).toBe(200)

    const after = await req(doctorToken, 'GET', '/api/insight/queue')
    const afterBody = (await after.json()) as Envelope & { patients: Array<{ id: string }> }
    expect(afterBody.patients.map((p) => p.id)).not.toContain(RATE_PATIENT_1)

    // 患者侧「我的医生」同步消失
    const list = await req(ratePatient1Token, 'GET', '/api/bindings')
    const listBody = (await list.json()) as Envelope & { doctors: Array<{ id: string }> }
    expect(listBody.doctors.map((d) => d.id)).not.toContain(DOCTOR_ID)

    // 审计：医生解除动作落盘（结构化，无 PII）
    const entries = readAuditEntries()
    expect(entries.some((e) => e.action === 'doctor_unbind' && e.patientId === RATE_PATIENT_1)).toBe(true)

    const again = await req(doctorToken, 'DELETE', `/api/doctor/bindings/${RATE_PATIENT_1}`)
    expect(again.status).toBe(404)
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
