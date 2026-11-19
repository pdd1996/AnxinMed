/**
 * 医患绑定服务（specs/25 · 演示最小闭环）——业务编排，不直接写 SQL。
 *
 * 流程：
 * 1. 医生（role='doctor'）生成一次性 6 位绑定码（10 分钟有效；重新生成会作废上一枚未使用码）；
 * 2. 患者（role='patient'）在患者端输入绑定码核销 → 建立/恢复 active 授权关系；
 * 3. 患者可随时解绑（status → revoked），医生端所有数据作用域立即收缩。
 *
 * 安全约束：
 * - 核销必须由患者账号完成，且不能绑定自己；
 * - 绑定码单次有效、原子核销（并发下只有一个患者成功）；
 * - 核销前过「患者账号 + IP」双维度滑动窗口限流（specs/25 §5 补强；超限 429 BIND_LOCKED）；
 * - 生成/核销/解绑写绑定安全审计（JSONL，绝不落绑定码明文）；
 * - 所有错误显式抛出（400/403/404/409/429/500），不静默吞错。
 */
import { randomInt, randomUUID } from 'node:crypto'
import {
  BIND_ALREADY_MESSAGE,
  BIND_CODE_INVALID_MESSAGE,
  BIND_CODE_LENGTH,
  BIND_CODE_LOCKED_MESSAGE,
  BIND_CODE_TTL_SEC,
  BIND_NOT_FOUND_MESSAGE,
  BIND_PATIENT_ONLY_MESSAGE,
  BIND_SELF_MESSAGE,
  ERR_CODES,
  type BindCodeCreateResponse,
  type BindRedeemResponse,
  type BindingListResponse,
} from '@anxin/shared'
import { consumeBindRedeem, clearBindRedeemForPatient } from '../lib/bind-rate-limit.js'
import { logBindAudit } from '../lib/observability/bind-audit.js'
import * as bindingRepo from '../repositories/binding.repo.js'
import { ApiError } from '../lib/http.js'
import { readAuthMode } from '../lib/auth/mode.js'
import type { User } from '../types.js'

/** 绑定码生成失败（连续撞 uuid/唯一冲突等）时的可见错误文案。 */
const BIND_CODE_GENERATE_FAILED_MESSAGE = '绑定码生成失败，请稍后重试'

/** 限流 429 文案：基础文案 + 建议等待分钟数（retryAfterSec 同时在 details 里给出）。 */
function bindLockedMessage(retryAfterSec: number): string {
  return `${BIND_CODE_LOCKED_MESSAGE}（约 ${Math.max(1, Math.ceil(retryAfterSec / 60))} 分钟后可重试）`
}

/** 生成一次性绑定码（医生端）。 */
export async function createBindCode(doctor: User): Promise<BindCodeCreateResponse> {
  // 同一医生只保留最新一枚有效码：旧码作废，避免患者拿到过期的码反复失败。
  await bindingRepo.deleteUnusedCodes(doctor.id)

  const expiresAt = new Date(Date.now() + BIND_CODE_TTL_SEC * 1000)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(0, 10 ** BIND_CODE_LENGTH)).padStart(BIND_CODE_LENGTH, '0')
    try {
      await bindingRepo.insertBindCode({
        id: `bcode-${randomUUID()}`,
        code,
        doctorId: doctor.id,
        expiresAt,
      })
      // 审计不含码明文：只记「哪位医生在何时生成了码」。
      logBindAudit({ action: 'bind_code_generated', actorUserId: doctor.id, doctorId: doctor.id })
      return { code, expiresAt: expiresAt.toISOString(), ttlSec: BIND_CODE_TTL_SEC }
    } catch (err) {
      // 唯一索引冲突（极小概率撞码）→ 重试；其余错误必须可见。
      const code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code
      if (code === '23505') continue
      throw err
    }
  }
  throw new ApiError(500, 'INTERNAL', BIND_CODE_GENERATE_FAILED_MESSAGE)
}

/** 患者核销绑定码 → 建立授权关系。 */
export async function redeemBindCode(
  patient: User,
  rawCode: string,
  clientKey = 'local',
): Promise<BindRedeemResponse> {
  if (patient.role !== 'patient') {
    throw new ApiError(403, ERR_CODES.FORBIDDEN, BIND_PATIENT_ONLY_MESSAGE)
  }

  // 双维度限流：每次尝试先过闸门；超限直接 429，不继续查询/枚举。
  const gate = consumeBindRedeem(patient.id, clientKey)
  if (!gate.allowed) {
    logBindAudit({ action: 'redeem_locked', actorUserId: patient.id, reason: 'rate_limited' })
    throw new ApiError(429, ERR_CODES.BIND_LOCKED, bindLockedMessage(gate.retryAfterSec), {
      retryAfterSec: gate.retryAfterSec,
    })
  }

  const row = await bindingRepo.findBindCode(rawCode.trim())
  if (!row) {
    logBindAudit({ action: 'redeem_rejected', actorUserId: patient.id, reason: 'invalid' })
    throw new ApiError(400, ERR_CODES.VALIDATION, BIND_CODE_INVALID_MESSAGE)
  }
  if (row.usedAt) {
    logBindAudit({
      action: 'redeem_rejected',
      actorUserId: patient.id,
      doctorId: row.doctorId,
      reason: 'used',
    })
    throw new ApiError(400, ERR_CODES.VALIDATION, BIND_CODE_INVALID_MESSAGE)
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    logBindAudit({
      action: 'redeem_rejected',
      actorUserId: patient.id,
      doctorId: row.doctorId,
      reason: 'expired',
    })
    throw new ApiError(400, ERR_CODES.VALIDATION, BIND_CODE_INVALID_MESSAGE)
  }
  if (row.doctorId === patient.id) {
    logBindAudit({ action: 'redeem_rejected', actorUserId: patient.id, reason: 'self' })
    throw new ApiError(400, ERR_CODES.VALIDATION, BIND_SELF_MESSAGE)
  }

  const existing = await bindingRepo.findLink(row.doctorId, patient.id)
  if (existing?.status === 'active') {
    logBindAudit({
      action: 'redeem_rejected',
      actorUserId: patient.id,
      doctorId: row.doctorId,
      reason: 'already_bound',
    })
    throw new ApiError(409, ERR_CODES.CONFLICT, BIND_ALREADY_MESSAGE)
  }

  // 原子核销：并发下只有一个患者能抢到该码。
  const consumed = await bindingRepo.markBindCodeUsed(row.id, patient.id)
  if (!consumed) {
    logBindAudit({
      action: 'redeem_rejected',
      actorUserId: patient.id,
      doctorId: row.doctorId,
      reason: 'used',
    })
    throw new ApiError(400, ERR_CODES.VALIDATION, BIND_CODE_INVALID_MESSAGE)
  }

  const link = await bindingRepo.upsertActiveLink({
    id: `link-${randomUUID()}`,
    doctorId: row.doctorId,
    patientId: patient.id,
    source: 'bind-code',
  })

  // 成功即清空该患者维度的尝试计数（IP 维度保留）；再写授权审计。
  clearBindRedeemForPatient(patient.id)
  logBindAudit({
    action: 'bind_succeeded',
    actorUserId: patient.id,
    doctorId: row.doctorId,
    patientId: patient.id,
  })

  const names = await bindingRepo.findUserNames([row.doctorId])
  return {
    doctor: {
      id: row.doctorId,
      name: names.get(row.doctorId) ?? null,
      boundAt: link.boundAt.toISOString(),
    },
  }
}

/** 患者端「我的医生」列表。 */
export async function listPatientDoctors(patientId: string): Promise<BindingListResponse> {
  const links = await bindingRepo.listActiveDoctorLinks(patientId)
  const names = await bindingRepo.findUserNames(links.map((l) => l.doctorId))
  return {
    doctors: links.map((l) => ({
      id: l.doctorId,
      name: names.get(l.doctorId) ?? null,
      boundAt: l.boundAt.toISOString(),
    })),
  }
}

/** 患者解绑医生（幂等语义：未找到有效绑定 → 404 可见，不静默成功）。 */
export async function unbindDoctor(patientId: string, doctorId: string): Promise<void> {
  const revoked = await bindingRepo.revokeLink(doctorId, patientId)
  if (!revoked) {
    throw new ApiError(404, ERR_CODES.NOT_FOUND, BIND_NOT_FOUND_MESSAGE)
  }
  logBindAudit({ action: 'bind_revoked', actorUserId: patientId, doctorId, patientId })
}

/**
 * 医生解绑患者（specs/25 增补 · 撤销权对称化）：
 * - 用于患者转诊、误绑清理等场景；解除只会**缩小**医生可见范围，不扩大数据访问；
 * - 与患者端解绑同一语义：status → revoked（保留授权历史），队列/摘要/问答立即不可见；
 * - 未找到有效绑定 → 404（不静默成功）；审计记 `doctor_unbind`。
 */
export async function unbindPatientAsDoctor(doctorId: string, patientId: string): Promise<void> {
  const revoked = await bindingRepo.revokeLink(doctorId, patientId)
  if (!revoked) {
    throw new ApiError(404, ERR_CODES.NOT_FOUND, BIND_NOT_FOUND_MESSAGE)
  }
  logBindAudit({ action: 'doctor_unbind', actorUserId: doctorId, doctorId, patientId })
}

/**
 * 医生端作用域解析：password 模式下返回「当前医生的授权患者 id 集合」；
 * demo 模式返回 undefined（旁路 = 不按关系过滤，保证既有演示/E2E 逐字不变）。
 *
 * 注意区分 undefined 与空数组：undefined = 全部（demo 旁路）；[] = 无授权患者（真实医生未绑定任何人）。
 */
export async function resolveDoctorPatientScope(doctorId: string): Promise<string[] | undefined> {
  if (readAuthMode() === 'demo') return undefined
  return bindingRepo.listActivePatientIds(doctorId)
}

/** 创建演示用绑定关系（seed / 运维脚本；不经 HTTP）。 */
export async function seedLink(doctorId: string, patientId: string): Promise<void> {
  await bindingRepo.upsertActiveLink({
    id: `link-${randomUUID()}`,
    doctorId,
    patientId,
    source: 'seed',
  })
}
