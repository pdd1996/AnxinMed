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
 * - 所有错误显式抛出（400/403/404/409/500），不静默吞错。
 */
import { randomInt, randomUUID } from 'node:crypto'
import {
  BIND_ALREADY_MESSAGE,
  BIND_CODE_INVALID_MESSAGE,
  BIND_CODE_LENGTH,
  BIND_CODE_TTL_SEC,
  BIND_NOT_FOUND_MESSAGE,
  BIND_PATIENT_ONLY_MESSAGE,
  BIND_SELF_MESSAGE,
  ERR_CODES,
  type BindCodeCreateResponse,
  type BindRedeemResponse,
  type BindingListResponse,
} from '@anxin/shared'
import * as bindingRepo from '../repositories/binding.repo.js'
import { ApiError } from '../lib/http.js'
import { readAuthMode } from '../lib/auth/mode.js'
import type { User } from '../types.js'

/** 绑定码生成失败（连续撞 uuid/唯一冲突等）时的可见错误文案。 */
const BIND_CODE_GENERATE_FAILED_MESSAGE = '绑定码生成失败，请稍后重试'

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
export async function redeemBindCode(patient: User, rawCode: string): Promise<BindRedeemResponse> {
  if (patient.role !== 'patient') {
    throw new ApiError(403, ERR_CODES.FORBIDDEN, BIND_PATIENT_ONLY_MESSAGE)
  }

  const row = await bindingRepo.findBindCode(rawCode.trim())
  const expired = row ? row.expiresAt.getTime() <= Date.now() : true
  if (!row || row.usedAt || expired) {
    throw new ApiError(400, ERR_CODES.VALIDATION, BIND_CODE_INVALID_MESSAGE)
  }
  if (row.doctorId === patient.id) {
    throw new ApiError(400, ERR_CODES.VALIDATION, BIND_SELF_MESSAGE)
  }

  const existing = await bindingRepo.findLink(row.doctorId, patient.id)
  if (existing?.status === 'active') {
    throw new ApiError(409, ERR_CODES.CONFLICT, BIND_ALREADY_MESSAGE)
  }

  // 原子核销：并发下只有一个患者能抢到该码。
  const consumed = await bindingRepo.markBindCodeUsed(row.id, patient.id)
  if (!consumed) {
    throw new ApiError(400, ERR_CODES.VALIDATION, BIND_CODE_INVALID_MESSAGE)
  }

  const link = await bindingRepo.upsertActiveLink({
    id: `link-${randomUUID()}`,
    doctorId: row.doctorId,
    patientId: patient.id,
    source: 'bind-code',
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
