/**
 * 绑定安全审计单测（specs/25 §5 补强）：JSONL 字段 / 按日文件 / 14 天保留 / 无敏感字段。
 *
 * 集成链路上「生成/拒绝/成功/解绑均落盘」由 doctor-binding.test.ts 覆盖；本文件只验证落盘形态，
 * 用注入时钟 + 临时 LOG_DIR，避免依赖真实时间与仓库目录。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BIND_AUDIT_RETENTION_DAYS, logBindAudit, resetBindAuditForTests } from '../lib/observability/bind-audit.js'
import { dateKey } from '../lib/observability/io.js'

/** 固定本地时刻（用本地分量构造，避免进程时区差异影响 dateKey）。 */
const FIXED_NOW = new Date(2026, 10, 19, 10, 0, 0)

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anxin-bind-audit-unit-'))
  process.env.LOG_DIR = dir
  resetBindAuditForTests()
})

afterEach(() => {
  delete process.env.LOG_DIR
  resetBindAuditForTests()
  rmSync(dir, { recursive: true, force: true })
})

function readEntry(fileName: string): Record<string, unknown> {
  const lines = readFileSync(join(dir, fileName), 'utf8').trim().split('\n')
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0] as string) as Record<string, unknown>
}

describe('bind-audit · JSONL 落盘', () => {
  it('按日写入 bind-audit-YYYY-MM-DD.jsonl，字段结构化（含 ts/action/actorUserId/目标 id）', () => {
    logBindAudit(
      { action: 'bind_succeeded', actorUserId: 'p-1', doctorId: 'd-1', patientId: 'p-1' },
      { now: FIXED_NOW },
    )

    const fileName = `bind-audit-${dateKey(FIXED_NOW)}.jsonl`
    expect(existsSync(join(dir, fileName))).toBe(true)
    const entry = readEntry(fileName)
    expect(entry.event).toBe('bind_audit')
    expect(entry.ts).toBe(FIXED_NOW.toISOString())
    expect(entry.action).toBe('bind_succeeded')
    expect(entry.actorUserId).toBe('p-1')
    expect(entry.doctorId).toBe('d-1')
    expect(entry.patientId).toBe('p-1')
    expect(entry.reason).toBeNull()
  })

  it('核销失败只落枚举 reason，不存在绑定码 / IP / 姓名等敏感字段', () => {
    logBindAudit(
      { action: 'redeem_rejected', actorUserId: 'p-1', doctorId: 'd-1', reason: 'used' },
      { now: FIXED_NOW },
    )

    const entry = readEntry(`bind-audit-${dateKey(FIXED_NOW)}.jsonl`)
    expect(entry.reason).toBe('used')
    for (const forbidden of ['code', 'ip', 'name', 'phone']) {
      expect(entry).not.toHaveProperty(forbidden)
    }
  })

  it(`保留 ${BIND_AUDIT_RETENTION_DAYS} 天：清理过期文件、保留窗口内与当日文件`, () => {
    const expired = new Date(FIXED_NOW.getTime())
    expired.setDate(expired.getDate() - BIND_AUDIT_RETENTION_DAYS - 1)
    const kept = new Date(FIXED_NOW.getTime())
    kept.setDate(kept.getDate() - (BIND_AUDIT_RETENTION_DAYS - 1))

    writeFileSync(join(dir, `bind-audit-${dateKey(expired)}.jsonl`), '{}\n')
    writeFileSync(join(dir, `bind-audit-${dateKey(kept)}.jsonl`), '{}\n')

    logBindAudit({ action: 'bind_code_generated', actorUserId: 'd-1', doctorId: 'd-1' }, { now: FIXED_NOW })

    expect(existsSync(join(dir, `bind-audit-${dateKey(expired)}.jsonl`))).toBe(false)
    expect(existsSync(join(dir, `bind-audit-${dateKey(kept)}.jsonl`))).toBe(true)
    expect(existsSync(join(dir, `bind-audit-${dateKey(FIXED_NOW)}.jsonl`))).toBe(true)
  })
})
