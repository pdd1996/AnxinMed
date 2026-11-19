/**
 * 绑定安全审计（JSONL，按日）——specs/25 §5 补强。
 *
 * 目的：医患授权是隐私边界动作，必须能回答「谁在何时对谁绑定/解绑、核销为什么失败」。
 * 落盘：${LOG_DIR}/bind-audit-YYYY-MM-DD.jsonl（LOG_DIR 默认 './logs'，已 gitignore）。
 * 字段：ts / event / action / actorUserId / doctorId / patientId / reason（均为内部 id 与枚举，绝无 PII）。
 *
 * 红线：
 * - **绝不记录绑定码明文**（它是短 TTL 凭据；失败只用枚举 reason 标记，便于排障又不扩大泄漏面）；
 * - 不记录 IP / 姓名 / 请求体；reason 只用本模块定义的枚举值；
 * - 保留 14 天（与错误日志同口径），每日首次写入时清理过期文件。
 *
 * 失败语义：审计落盘失败 → console.error 可见，但**不向业务请求冒泡**（主流程/错误响应优先）；
 * 与 error-log 同构，避免「日志故障导致用户绑定失败」。
 *
 * 边界：JSONL 是本切片（方案 A）的轻量审计；可查询的独立审计表仍属 specs/25 §8 方案 B。
 */
import { appendFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { dateKey, ensureLogDir } from './io.js'

/** 审计文件保留天数：14 天（当天 + 前 13 天）。 */
export const BIND_AUDIT_RETENTION_DAYS = 14

const FILE_NAME_RE = /^bind-audit-(\d{4}-\d{2}-\d{2})\.jsonl$/

/** 审计动作（枚举固定，便于检索与后续迁移进审计表）。 */
export type BindAuditAction =
  | 'bind_code_generated' // 医生生成/重新生成绑定码
  | 'bind_succeeded' // 患者核销成功，建立授权
  | 'bind_revoked' // 患者解绑
  | 'doctor_unbind' // 医生端解除患者（specs/25 增补：撤销权对称化）
  | 'redeem_rejected' // 核销被拒（绑定码无效/过期/已用/自绑/已绑定）
  | 'redeem_locked' // 核销触发限流（429）

/** 核销被拒原因（枚举；不记录所填绑定码）。 */
export type BindRejectReason = 'invalid' | 'expired' | 'used' | 'self' | 'already_bound' | 'rate_limited'

/** 一条审计记录（调用方只传结构化字段，不传原文）。 */
export interface BindAuditRecord {
  action: BindAuditAction
  /** 动作发起人（医生生成码 / 患者核销、解绑）→ users.id。 */
  actorUserId: string
  /** 动作目标医生 → users.id（核销失败且码无效时可能未知）。 */
  doctorId?: string
  /** 动作目标患者 → users.id（医生生成码时无目标患者）。 */
  patientId?: string
  /** 失败原因（仅 redeem_rejected / redeem_locked 使用）。 */
  reason?: BindRejectReason
}

export interface BindAuditOptions {
  /** 测试注入时钟（默认真实时间）。 */
  now?: Date
}

/** 上次清理日（每天首次写入执行一次清理）。 */
let lastCleanupDay = ''

/** 清空进程内状态（单测用，避免用例间串扰）。 */
export function resetBindAuditForTests(): void {
  lastCleanupDay = ''
}

/** 删除超过保留期的审计文件（按文件名日期）；每天最多执行一次。 */
function cleanupExpired(dir: string, now: Date): void {
  const today = dateKey(now)
  if (lastCleanupDay === today) return
  lastCleanupDay = today

  const cutoff = new Date(now.getTime())
  cutoff.setDate(cutoff.getDate() - Math.max(1, BIND_AUDIT_RETENTION_DAYS) + 1)
  const cutoffDay = dateKey(cutoff)

  for (const name of readdirSync(dir)) {
    const match = FILE_NAME_RE.exec(name)
    if (!match || match[1] >= cutoffDay) continue
    try {
      unlinkSync(join(dir, name))
    } catch (e) {
      console.error(
        `[obs:bind-audit] 清理过期审计文件失败（${name}）：${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
}

/**
 * 写一条绑定安全审计（JSONL 追加）。
 * 落盘失败只打印可见错误，绝不向业务请求冒泡。
 */
export function logBindAudit(record: BindAuditRecord, options: BindAuditOptions = {}): void {
  try {
    const now = options.now ?? new Date()
    const day = dateKey(now)
    const dir = ensureLogDir()
    cleanupExpired(dir, now)

    const entry = {
      ts: now.toISOString(),
      event: 'bind_audit' as const,
      action: record.action,
      actorUserId: record.actorUserId,
      doctorId: record.doctorId ?? null,
      patientId: record.patientId ?? null,
      reason: record.reason ?? null,
    }
    appendFileSync(join(dir, `bind-audit-${day}.jsonl`), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (e) {
    console.error(`[obs:bind-audit] 审计落盘失败：${e instanceof Error ? e.message : String(e)}`)
  }
}
