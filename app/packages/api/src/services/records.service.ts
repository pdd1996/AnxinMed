/**
 * 服药记录服务（任务书 T7）。迁移自 demo/src/App.tsx 的 updateTask。
 * 与 demo 的差异：demo 对同 (计划,日期,时间点) 是覆盖更新；本 API 按任务书要求重复操作返回 409
 * （防重复二次确认的接口面）。库存扣减/开封日由 records.repo 在事务内完成。
 */
import { ERR_CODES, type RecordCreate } from '@anxin/shared'
import * as recordsRepo from '../repositories/records.repo.js'
import * as plansRepo from '../repositories/plans.repo.js'
import { ApiError } from '../lib/http.js'

export async function createRecord(userId: string, input: RecordCreate) {
  const plan = await plansRepo.findPlan(userId, input.planId)
  if (!plan) throw new ApiError(404, ERR_CODES.NOT_FOUND, '计划不存在')

  const row = await recordsRepo.insertRecord({
    userId,
    planId: input.planId,
    date: input.date,
    time: input.time,
    status: input.status,
  })
  if (!row) {
    throw new ApiError(409, ERR_CODES.CONFLICT, '该时间点已记录过，请勿重复操作')
  }
  return {
    id: row.id,
    planId: row.planId,
    scheduledDate: row.scheduledDate,
    scheduledTime: row.scheduledTime,
    status: row.status,
    actedAt: row.actedAt.toISOString(),
  }
}
