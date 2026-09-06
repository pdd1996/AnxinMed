/**
 * 健康信息服务（任务书 T9）。health_profiles 按字段读写（PRD §7.1.2 字段级来源标注）。
 * 手动填写一律标 source='self_reported'；处方抄录·已确认（prescription_confirmed）由 M2 确认页写入。
 */
import type { ProfilePatch } from '@anxin/shared'
import * as profilesRepo from '../repositories/profiles.repo.js'
import type { HealthRow } from '../repositories/profiles.repo.js'
import { newId } from '../lib/util.js'

/** DB 行 → HealthEntryDTO 传输形态。 */
export function toHealthDto(row: HealthRow) {
  return {
    id: row.id,
    fieldKey: row.fieldKey,
    value: row.value,
    sourceMeta: (row.sourceMeta ?? null) as {
      source: 'self_reported' | 'prescription_confirmed'
      confirmedAt?: string
    } | null,
  }
}

export async function listProfile(userId: string) {
  const rows = await profilesRepo.listByUser(userId)
  return rows.map(toHealthDto)
}

/** 按字段 upsert / 删除；手动写入标「用户自述」并记确认时间。返回更新后的全量列表。 */
export async function patchProfile(userId: string, input: ProfilePatch) {
  const now = new Date()
  for (const upsert of input.upserts ?? []) {
    const sourceMeta = { source: 'self_reported' as const, confirmedAt: now.toISOString() }
    const existing = await profilesRepo.findByField(userId, upsert.fieldKey)
    if (existing) {
      await profilesRepo.updateHealth(userId, upsert.fieldKey, { value: upsert.value, sourceMeta })
    } else {
      await profilesRepo.insertHealth({
        id: newId('health'),
        userId,
        fieldKey: upsert.fieldKey,
        value: upsert.value,
        sourceMeta,
      })
    }
  }
  for (const fieldKey of input.deletes ?? []) {
    await profilesRepo.deleteByField(userId, fieldKey)
  }
  return listProfile(userId)
}
