/**
 * 草稿服务（M2-T6）。T6a 只含读取（GET /api/drafts/:id）；confirm/reject 单事务在 T6b 追加。
 *
 * drafts.payload 落库为 jsonb，读回为 unknown；本服务由本系统写入的 DraftPayload 结构cast 回来，
 * 经 GET 路由返回类型 → hc<AppType> 端到端推导给 web（确认页 T7 消费）。
 */
import { ERR_CODES } from '@anxin/shared'
import { ApiError } from '../lib/http.js'
import * as draftsRepo from '../repositories/drafts.repo.js'
import type { DraftRow } from '../repositories/drafts.repo.js'
import type { DraftPayload } from './pipeline/index.js'

export function toDraftDto(row: DraftRow) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    payload: row.payload as DraftPayload,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** GET /api/drafts/:id：草稿详情（含原文对照数据：裁剪几何 + 低置信字符坐标）。 */
export async function getDraft(userId: string, id: string) {
  const row = await draftsRepo.findDraft(userId, id)
  if (!row) throw new ApiError(404, ERR_CODES.NOT_FOUND, '草稿不存在')
  return toDraftDto(row)
}
