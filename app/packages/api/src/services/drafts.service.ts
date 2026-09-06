/**
 * 草稿服务（M2-T6）—— 读取（GET）+ 确认/拒绝单事务（T6b）。
 *
 * confirmDraft 是录入主线唯一闸门（PRD §7.2.5）：单事务原子写 sources + drugs + plans + health_profiles
 * + drafts.status=confirmed + 确认留痕；任一步失败整体回滚，绝不留脏数据（执行总纲 §3.2.1）。
 * 追溯上下文（来源类型 / 白名单快照 / 裁剪引用 / 脱敏审计）从已存 drafts.payload 取，
 * 客户端只提交「已核对的最终决策」，无法伪造追溯数据。
 */
import { ERR_CODES, type ConfirmStatus, type DraftConfirm, type DraftReject } from '@anxin/shared'
import { db } from '../db/client.js'
import { ApiError } from '../lib/http.js'
import { newId } from '../lib/util.js'
import * as draftsRepo from '../repositories/drafts.repo.js'
import * as sourcesRepo from '../repositories/sources.repo.js'
import * as drugsRepo from '../repositories/drugs.repo.js'
import * as plansRepo from '../repositories/plans.repo.js'
import * as profilesRepo from '../repositories/profiles.repo.js'
import type { DraftRow } from '../repositories/drafts.repo.js'
import type { DraftPayload } from './pipeline/index.js'

/** 确认方式留痕（缺省按 confirmStatus 推导；对齐 demo confirmMethod 文案）。 */
const CONFIRM_METHOD: Record<ConfirmStatus, string> = {
  transcribed: '处方抄录确认',
  ocr_matched: 'OCR 唯一匹配确认',
  manual: '手动建档',
}

/** type 别名（非 interface）以满足 okJson 的 Record<string, unknown> 约束。 */
export type ConfirmDraftResult = {
  drugId: string
  planId: string | null
  sourceId: string
  status: 'confirmed'
}
export type RejectDraftResult = { id: string; status: 'rejected' }

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

/** 载入并守卫草稿：不存在 → 404；非 pending（已确认/拒绝）→ 409（防重复操作）。 */
async function loadPendingDraft(userId: string, id: string): Promise<DraftRow> {
  const draft = await draftsRepo.findDraft(userId, id)
  if (!draft) throw new ApiError(404, ERR_CODES.NOT_FOUND, '草稿不存在')
  if (draft.status !== 'pending') {
    throw new ApiError(409, ERR_CODES.CONFLICT, `草稿已${draft.status === 'confirmed' ? '确认' : '拒绝'}，请勿重复操作`)
  }
  return draft
}

/** 关键字段快照（确认留痕）：药名/规格/剂型 + 有计划的用量/频次/疗程/结束日期。 */
function buildKeySnapshot(input: DraftConfirm): Record<string, string> {
  const snap: Record<string, string> = {
    药名: input.drug.genericName,
    规格: input.drug.specification ?? '',
    剂型: input.drug.form ?? '',
  }
  const p = input.plan
  if (p) {
    snap.用量 = `${p.dose.value} ${p.dose.unit}`
    snap.频次 = `每日 ${p.frequency} 次`
    snap.疗程 =
      p.cycleType === 'open' ? '长期服用' : p.cycleType === 'stock' ? '用完为止' : p.endDate ? `至 ${p.endDate}` : '自定义疗程'
    if (p.endDate) snap.结束日期 = p.endDate
  }
  return snap
}

/**
 * POST /api/drafts/:id/confirm —— 单事务原子写四表 + 状态翻转 + 确认留痕。
 * 写入顺序：① sources → ② drugs → ③ plans（如有）→ ④ health_profiles（勾选项）→ ⑤ drafts.status。
 * 任一步抛错（含 ⑤ 竞态命中 0 行）→ 整个事务回滚，四表无残留、draft 仍 pending。
 */
export async function confirmDraft(userId: string, id: string, input: DraftConfirm): Promise<ConfirmDraftResult> {
  const draft = await loadPendingDraft(userId, id)
  const payload = draft.payload as DraftPayload

  const now = new Date()
  const nowIso = now.toISOString()
  const sourceId = newId('src')
  const drugId = newId('drug')
  const planId = input.plan ? newId('plan') : null
  const method = input.method ?? CONFIRM_METHOD[input.drug.confirmStatus]
  const isPrescription = payload.type === 'prescription'

  await db.transaction(async (tx) => {
    // ① sources：三层追溯锚点 + 确认留痕（追溯上下文全部从 payload 取，客户端无法伪造）
    await sourcesRepo.insertSource(
      {
        id: sourceId,
        userId,
        type: isPrescription ? 'prescription' : 'drug_box',
        bodyImageRef: payload.bodyImageRef ?? null,
        whitelistFields: payload.whitelist ?? null,
        prescriptionNo: payload.prescriptionNo ?? null,
        sanitizeAudit: payload.sanitizeAudit ?? null,
        confirmTrace: { confirmedAt: nowIso, method, keyFieldsSnapshot: buildKeySnapshot(input), draftId: id },
      },
      tx,
    )
    // ② drugs：确认后拷贝的个人档案（≠ drug_master）
    await drugsRepo.insertDrug(
      {
        id: drugId,
        userId,
        genericName: input.drug.genericName,
        brandName: input.drug.brandName ?? null,
        specification: input.drug.specification ?? null,
        form: input.drug.form ?? null,
        manufacturer: input.drug.manufacturer ?? null,
        drugMasterId: input.drug.drugMasterId ?? null,
        confirmStatus: input.drug.confirmStatus,
        stock: input.drug.stock ?? null,
        openedAt: input.drug.openedAt ?? null,
        expiry: input.drug.expiry ?? null,
        sourceId,
        confirmedAt: now,
      },
      tx,
    )
    // ③ plans：如带计划（入口B 建档通常无；source 按草稿类型定处方/手动）
    if (input.plan && planId) {
      await plansRepo.insertPlan(
        {
          id: planId,
          userId,
          drugId,
          dose: input.plan.dose,
          frequency: input.plan.frequency,
          times: input.plan.times,
          route: input.plan.route ?? null,
          meal: input.plan.meal ?? null,
          cycleType: input.plan.cycleType,
          startDate: input.plan.startDate,
          endDate: input.plan.endDate ?? null,
          status: 'active',
          source: isPrescription ? 'prescription' : 'manual',
          sourceId,
          itemId: null,
          tags: input.plan.tags ?? payload.planDraft?.tags ?? null,
        },
        tx,
      )
    }
    // ④ health_profiles：勾选项 upsert（字段级来源标 prescription_confirmed）
    for (const h of input.health ?? []) {
      const sourceMeta = { source: 'prescription_confirmed' as const, confirmedAt: nowIso }
      const existing = await profilesRepo.findByField(userId, h.fieldKey, tx)
      if (existing) {
        await profilesRepo.updateHealth(userId, h.fieldKey, { value: h.value, sourceMeta }, tx)
      } else {
        await profilesRepo.insertHealth({ id: newId('h'), userId, fieldKey: h.fieldKey, value: h.value, sourceMeta }, tx)
      }
    }
    // ⑤ drafts.status=confirmed（竞态安全：命中 0 行说明已被处理 → 抛 409 触发回滚）
    const updated = await draftsRepo.resolveDraft(userId, id, 'confirmed', undefined, tx)
    if (!updated) throw new ApiError(409, ERR_CODES.CONFLICT, '草稿状态已变更，请刷新后重试')
  })

  return { drugId, planId, sourceId, status: 'confirmed' }
}

/** POST /api/drafts/:id/reject —— status=rejected 留痕（rejectReason/rejectedAt 并入 payload）。 */
export async function rejectDraft(userId: string, id: string, input: DraftReject): Promise<RejectDraftResult> {
  const draft = await loadPendingDraft(userId, id)
  const merged = {
    ...(draft.payload as Record<string, unknown>),
    rejectReason: input.reason ?? null,
    rejectedAt: new Date().toISOString(),
  }
  const updated = await draftsRepo.resolveDraft(userId, id, 'rejected', merged)
  if (!updated) throw new ApiError(409, ERR_CODES.CONFLICT, '草稿状态已变更，请刷新后重试')
  return { id, status: 'rejected' }
}
