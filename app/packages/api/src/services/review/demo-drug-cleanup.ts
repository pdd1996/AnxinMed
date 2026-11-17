/**
 * M9-T1 · demo 药箱重复行清理规划器（纯函数）。
 *
 * 背景：p-001 的海露有 4 行 `drugs`（1 transcribed 在用 + 3 条 ocr_matched 测试残留），
 * 属于重复入库，不是产品数据。清理原则：
 * - 有任何引用（plan / risk_event / draft payload）的行**永不删**；
 * - 至少保留 1 行；若要删到 0 行 → 报错不删；
 * - 只处理指定 (userId, drugMasterId) 分组，不跨用户/跨药；
 * - 默认不伪造核对状态（manual 就是 manual）。
 */
export interface DemoDrugRow {
  id: string
  userId: string
  drugMasterId: string | null
  genericName: string
  brandName: string | null
  confirmStatus: string
  createdAt: string
}

export interface DemoDrugRefs {
  planRefs: number
  riskEventRefs: number
  draftRefs: number
}

export interface CleanupPlan {
  deletes: string[]
  keeps: string[]
  keepReasons: Record<string, string>
  errors: string[]
}

const STATUS_PRIORITY: Record<string, number> = { transcribed: 3, ocr_matched: 2, manual: 1 }

function isReferenced(refs: DemoDrugRefs): boolean {
  return refs.planRefs + refs.riskEventRefs + refs.draftRefs > 0
}

/**
 * @param rows 目标用户 + 目标 drug_master 下的全部 drugs 行
 * @param refsById 每行的引用计数
 */
export function planDemoDrugCleanup(rows: DemoDrugRow[], refsById: Record<string, DemoDrugRefs>): CleanupPlan {
  const plan: CleanupPlan = { deletes: [], keeps: [], keepReasons: {}, errors: [] }
  if (rows.length === 0) {
    plan.errors.push('目标分组没有 drugs 行，无需清理')
    return plan
  }

  const kept: DemoDrugRow[] = []
  const candidates: DemoDrugRow[] = []
  for (const row of rows) {
    const refs = refsById[row.id] ?? { planRefs: 0, riskEventRefs: 0, draftRefs: 0 }
    if (isReferenced(refs)) {
      kept.push(row)
      plan.keepReasons[row.id] = `有引用（plan ${refs.planRefs} / risk_event ${refs.riskEventRefs} / draft ${refs.draftRefs}）`
    } else {
      candidates.push(row)
    }
  }

  // 没有任何被引用行时，按状态优先级保留 1 行（宁可留重复，也不删到空）
  if (kept.length === 0) {
    const sorted = [...candidates].sort(
      (a, b) => (STATUS_PRIORITY[b.confirmStatus] ?? 0) - (STATUS_PRIORITY[a.confirmStatus] ?? 0) || b.createdAt.localeCompare(a.createdAt),
    )
    const keep = sorted[0]
    kept.push(keep)
    plan.keepReasons[keep.id] = '无引用行，按状态优先级保留 1 行（不删到空）'
    candidates.splice(candidates.indexOf(keep), 1)
  }

  // 其余无引用行可删；若已无重复（幂等复跑），deletes 为空属正常 no-op
  plan.deletes = candidates.map((r) => r.id)
  plan.keeps = kept.map((r) => r.id)
  return plan
}
