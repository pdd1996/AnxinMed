/**
 * 说明书人工核对 · 应用服务（M6-T9）。
 *
 * 校验全部决策 → 一个事务落库；任一条失败整批不写（all-or-nothing）。
 * 已 reviewed 的行幂等跳过；reject 只写审计不改状态。
 */
import { eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { manualReviewLog, packageInserts } from '../../db/schema.js'
import {
  planItem,
  type ApplyPlan,
  type InsertSnapshot,
  type ReviewDecisions,
} from './decisions.js'

export interface ApplyCounts {
  promote: number
  reject: number
  skip: number
}

export interface ApplyResult {
  plans: ApplyPlan[]
  counts: ApplyCounts
  errors: string[]
}

interface UpdateValues {
  indication?: string
  contraindication?: string[]
  precautions?: string[]
  adverseReactions?: string
  interactions?: string
  dosage?: { raw: string }
}

function applyCorrections(plan: ApplyPlan, snapshot: InsertSnapshot): { sections: Record<string, string>; values: UpdateValues } {
  const sections = { ...(snapshot.sourceSections ?? {}) }
  const values: UpdateValues = {}
  for (const c of plan.corrections) {
    sections[c.sourceKey] = c.to
    if (c.field === 'indication') values.indication = c.to
    else if (c.field === 'contraindication') values.contraindication = [c.to]
    else if (c.field === 'precautions') values.precautions = [c.to]
    else if (c.field === 'adverse') values.adverseReactions = c.to
    else if (c.field === 'interactions') values.interactions = c.to
    else if (c.field === 'dosage') values.dosage = { raw: c.to }
  }
  return { sections, values }
}

export function countPlans(plans: ApplyPlan[]): ApplyCounts {
  return {
    promote: plans.filter((p) => p.action === 'promote' && !p.note.startsWith('已 reviewed')).length,
    reject: plans.filter((p) => p.action === 'reject').length,
    skip: plans.filter((p) => p.action === 'skip' || p.note.startsWith('已 reviewed')).length,
  }
}

export async function applyDecisions(
  decisions: ReviewDecisions,
  reviewer: string,
  opts: { dryRun?: boolean } = {},
): Promise<ApplyResult> {
  const ids = decisions.items.map((i) => i.insertId)
  const duplicate = ids.filter((id, idx) => ids.indexOf(id) !== idx)
  if (duplicate.length) {
    return { plans: [], counts: { promote: 0, reject: 0, skip: 0 }, errors: [`decisions 含重复 insertId：${[...new Set(duplicate)].join(', ')}`] }
  }

  const rows = await db.select({
    id: packageInserts.id,
    drugId: packageInserts.drugId,
    curationStatus: packageInserts.curationStatus,
    contentHash: packageInserts.contentHash,
    sourceSections: packageInserts.sourceSections,
    indication: packageInserts.indication,
    contraindications: packageInserts.contraindications,
    precautions: packageInserts.precautions,
    adverseReactions: packageInserts.adverseReactions,
    interactions: packageInserts.interactions,
    dosage: packageInserts.dosage,
  }).from(packageInserts).where(inArray(packageInserts.id, ids))

  const snapshots = new Map(rows.map((r) => [r.id, { ...r, insertId: r.id } satisfies InsertSnapshot]))
  const missing = ids.filter((id) => !snapshots.has(id))
  if (missing.length) {
    return { plans: [], counts: { promote: 0, reject: 0, skip: 0 }, errors: [`数据库找不到这些说明书行：${missing.join(', ')}`] }
  }

  const plans = decisions.items.map((item) => planItem(item, snapshots.get(item.insertId)!))
  const failed = plans.filter((p) => p.errors.length > 0)
  if (failed.length) {
    return {
      plans,
      counts: { promote: 0, reject: 0, skip: 0 },
      errors: failed.flatMap((p) => p.errors.map((e) => `${p.drugId}: ${e}`)),
    }
  }

  const counts = countPlans(plans)
  if (opts.dryRun) return { plans, counts, errors: [] }

  const runAt = new Date()
  await db.transaction(async (tx) => {
    for (const plan of plans) {
      if (plan.action === 'reject') {
        await tx.insert(manualReviewLog).values({
          insertId: plan.insertId,
          action: 'reject',
          reviewer,
          diff: { batchId: decisions.batchId, reason: plan.rejectReason },
        })
        continue
      }
      if (plan.action !== 'promote' || plan.note.startsWith('已 reviewed')) continue

      const snapshot = snapshots.get(plan.insertId)!
      const { sections, values } = applyCorrections(plan, snapshot)
      await tx.update(packageInserts)
        .set({
          curationStatus: 'reviewed',
          reviewedBy: reviewer,
          reviewedAt: runAt,
          reviewMeta: plan.reviewMeta,
          sourceSections: sections,
          updatedAt: runAt,
          ...(values.indication !== undefined ? { indication: values.indication } : {}),
          ...(values.contraindication !== undefined ? { contraindications: values.contraindication } : {}),
          ...(values.precautions !== undefined ? { precautions: values.precautions } : {}),
          ...(values.adverseReactions !== undefined ? { adverseReactions: values.adverseReactions } : {}),
          ...(values.interactions !== undefined ? { interactions: values.interactions } : {}),
          ...(values.dosage !== undefined ? { dosage: values.dosage } : {}),
        })
        .where(eq(packageInserts.id, plan.insertId))

      for (const c of plan.corrections) {
        await tx.insert(manualReviewLog).values({
          insertId: plan.insertId,
          action: 'correct',
          reviewer,
          diff: { field: c.field, from: c.from, to: c.to, reason: c.reason, batchId: decisions.batchId },
        })
      }
      await tx.insert(manualReviewLog).values({
        insertId: plan.insertId,
        action: 'promote',
        reviewer,
        diff: { batchId: decisions.batchId, sections: plan.reviewMeta?.sections ?? {}, corrections: plan.corrections.length },
      })
    }
  })

  return { plans, counts, errors: [] }
}
