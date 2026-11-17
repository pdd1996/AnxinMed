/**
 * 说明书规格修复 · 落库脚本（M6-T9-fix，2026-11-14）
 *
 * 解析器与校验在 services/review/spec-repair.ts（纯函数，可单测）；本文件只做 I/O：
 * 读操作清单 + 修正草稿 → 载入库内快照 → 规划 → dry-run 打印 / --apply 单事务执行。
 *
 * 用法（在 app/ 下执行）：
 *   pnpm --filter @anxin/api db:repair-specs -- --ops <repair-ops.json> --drafts <dir>           # dry-run
 *   pnpm --filter @anxin/api db:repair-specs -- --ops <repair-ops.json> --drafts <dir> --apply
 *
 * 插入新行不归本脚本：修正草稿由 db:import-manuals 导入（按 (drugId, sourceDocumentId) 幂等，
 * reviewed 行 write-once 不覆盖）。
 */
import '../lib/env.js'
import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, inArray } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import { makeIdentityKey } from '../db/identity.js'
import { ManualDraftSchema, type Draft } from '../db/manual-draft.js'
import { drugMaster, drugs, interactionRules, manualReviewLog, packageInserts } from '../db/schema.js'
import {
  normalizeSpec,
  planRepair,
  RepairOpsSchema,
  type InsertLite,
  type PlanContext,
  type RepairOps,
  type RepairPlan,
} from '../services/review/spec-repair.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')
const repairLogPath = join(repoRoot, 'data', 'import-log.jsonl')
const REVIEWER = 'spec-repair-2026-11-14'

interface DbContext extends PlanContext {
  rows: Map<string, typeof packageInserts.$inferSelect>
  mastersFull: Map<string, typeof drugMaster.$inferSelect>
}

async function loadContext(ops: RepairOps, drafts: Map<string, Draft>): Promise<DbContext> {
  const drugIds = new Set<string>()
  const pdfs = new Set<string>()
  for (const op of ops.ops) {
    if (op.op === 'delete') {
      drugIds.add(op.drugId)
    } else {
      drugIds.add(op.fromId)
      drugIds.add(op.toId)
    }
    pdfs.add(op.pdf)
  }
  // 一次取回涉及 PDF 的说明书行（修复前 drugId 就是行身份）
  const insertRows = await db.select().from(packageInserts).where(inArray(packageInserts.sourceFile, [...pdfs]))
  const rowById = new Map(insertRows.map((r) => [r.id, r]))
  const masterIds = new Set<string>(drugIds)
  for (const r of insertRows) masterIds.add(r.drugId)

  const masterRows = masterIds.size
    ? await db.select().from(drugMaster).where(inArray(drugMaster.id, [...masterIds]))
    : []
  const mastersFull = new Map(masterRows.map((r) => [r.id, r]))

  const allMasters = await db.select({
    id: drugMaster.id,
    identityKey: drugMaster.identityKey,
    curationStatus: drugMaster.curationStatus,
  }).from(drugMaster)
  const masters = new Map(allMasters.map((m) => [m.id, { id: m.id, identityKey: m.identityKey, curationStatus: m.curationStatus }]))

  const userRefRows = await db.select({ drugMasterId: drugs.drugMasterId, id: drugs.id }).from(drugs)
  const userRefs = new Map<string, number>()
  for (const r of userRefRows) {
    if (r.drugMasterId) userRefs.set(r.drugMasterId, (userRefs.get(r.drugMasterId) ?? 0) + 1)
  }
  const rules = await db.select({ drugIds: interactionRules.drugIds }).from(interactionRules)
  const ruleRefs = new Map<string, number>()
  for (const r of rules) {
    for (const id of (r.drugIds ?? []) as string[]) {
      ruleRefs.set(id, (ruleRefs.get(id) ?? 0) + 1)
    }
  }

  const insertsById = new Map<string, InsertLite>()
  const insertsByKey = new Map<string, InsertLite>()
  for (const r of insertRows) {
    const lite: InsertLite = {
      id: r.id,
      drugId: r.drugId,
      sourceFile: r.sourceFile,
      version: r.version,
      sourceDocumentId: r.sourceDocumentId,
      specification: r.specification,
      curationStatus: r.curationStatus,
      reviewedBy: r.reviewedBy,
    }
    insertsById.set(lite.id, lite)
    if (lite.sourceFile) insertsByKey.set(`${lite.drugId}|${lite.sourceFile}`, lite)
  }
  return { insertsByKey, insertsById, masters, drafts, userRefs, ruleRefs, rows: rowById, mastersFull }
}

function loadDrafts(dir: string): Map<string, Draft> {
  const drafts = new Map<string, Draft>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const parsed = ManualDraftSchema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')))
    if (!parsed.success) {
      throw new Error(`${file}: 修正草稿校验失败 — ${parsed.error.issues.map((i) => i.message).join('; ')}`)
    }
    drafts.set(parsed.data.drugId, parsed.data)
  }
  return drafts
}

async function applyPlan(plan: RepairPlan, ctx: DbContext): Promise<void> {
  const runAt = new Date()
  await db.transaction(async (tx) => {
    for (const step of plan.steps) {
      if (step.kind === 'delete-insert') {
        await tx.delete(packageInserts).where(eq(packageInserts.id, step.insertId))
        continue
      }
      if (step.kind === 'delete-master') {
        await tx.delete(drugMaster).where(eq(drugMaster.id, step.masterId))
        continue
      }
      if (step.kind === 'update-spec') {
        const row = ctx.rows.get(step.insertId)
        if (!row) throw new Error(`update-spec 行消失：${step.insertId}`)
        const draft = ctx.drafts.get(step.drugId)!
        const identityKey = makeIdentityKey({
          genericName: draft.genericName,
          specification: draft.specification,
          form: draft.form,
          manufacturer: draft.manufacturer,
          approvalNumbers: draft.approvalNumbers,
        })
        await tx.update(packageInserts)
          .set({ specification: step.toSpec, updatedAt: runAt })
          .where(eq(packageInserts.id, step.insertId))
        await tx.update(drugMaster)
          .set({ specification: step.toSpec, identityKey, updatedAt: runAt })
          .where(eq(drugMaster.id, row.drugId))
        if (step.reviewed) {
          await tx.insert(manualReviewLog).values({
            insertId: step.insertId,
            action: 'correct',
            reviewer: REVIEWER,
            diff: {
              kind: 'spec-repair',
              field: 'specification',
              from: step.fromSpec,
              to: step.toSpec,
              drugId: row.drugId,
              reason: '源文【规格】段解析缺陷修复（M6-T9-fix）',
            },
          })
        }
        continue
      }

      // rename
      const row = ctx.rows.get(step.fromInsertId)
      if (!row) throw new Error(`rename 行消失：${step.fromInsertId}`)
      const oldMaster = ctx.mastersFull.get(step.fromDrugId)
      const draft = ctx.drafts.get(step.toDrugId)!
      const identityKey = makeIdentityKey({
        genericName: draft.genericName,
        specification: draft.specification,
        form: draft.form,
        manufacturer: draft.manufacturer,
        approvalNumbers: draft.approvalNumbers,
      })
      const primaryApproval = draft.approvalNumbers.find((a) => !a.includes('分包装')) ?? draft.approvalNumbers[0] ?? null

      if (step.moveMaster && oldMaster) {
        await tx.update(drugMaster)
          .set({
            id: step.toDrugId,
            specification: step.toSpec,
            identityKey,
            approvalNumber: primaryApproval,
            approvalNumbers: draft.approvalNumbers,
            updatedAt: runAt,
          })
          .where(eq(drugMaster.id, step.fromDrugId))
      } else if (oldMaster) {
        await tx.insert(drugMaster).values({
          ...oldMaster,
          id: step.toDrugId,
          specification: step.toSpec,
          identityKey,
          approvalNumber: primaryApproval,
          approvalNumbers: draft.approvalNumbers,
          updatedAt: runAt,
        })
      }

      const { id: _id, drugId: _drugId, createdAt: _createdAt, ...rest } = row
      await tx.insert(packageInserts).values({
        ...rest,
        id: step.toInsertId,
        drugId: step.toDrugId,
        specification: step.toSpec,
        updatedAt: runAt,
      })
      await tx.delete(packageInserts).where(eq(packageInserts.id, step.fromInsertId))

      const relinked = await tx.update(drugs)
        .set({ drugMasterId: step.toDrugId, updatedAt: runAt })
        .where(eq(drugs.drugMasterId, step.fromDrugId))
        .returning({ id: drugs.id })
      if (relinked.length > 0) {
        console.log(`    ↪ 用户药箱重指 ${relinked.length} 条：${step.fromDrugId} → ${step.toDrugId}`)
      }

      if (step.reviewed) {
        await tx.insert(manualReviewLog).values({
          insertId: step.toInsertId,
          action: 'correct',
          reviewer: REVIEWER,
          diff: {
            kind: 'spec-repair',
            field: 'specification',
            from: step.fromSpec,
            to: step.toSpec,
            drugIdFrom: step.fromDrugId,
            drugIdTo: step.toDrugId,
            reviewedPreserved: true,
            reason: '源文【规格】段解析缺陷修复（M6-T9-fix）',
          },
        })
      }
    }
  })

  appendFileSync(repairLogPath, `${JSON.stringify({
    runAt: runAt.toISOString(),
    run: 'spec-repair-2026-11-14',
    counts: plan.counts,
  })}\n`)
}

/**
 * 同步 drug_master 的批准文号字段（规格修复的附带影响：批准文号按规格分组匹配，
 * 规格修正后 parse_approvals 的分组结果也会变；identity_key 已由修复主流程写对，
 * 这里补齐 approval_number / approval_numbers 两列，避免产品行与说明书行口径不一致）。
 */
async function syncMasterFields(draftsDir: string, apply: boolean): Promise<number> {
  const drafts = loadDrafts(draftsDir)
  const ids = [...drafts.keys()]
  const rows = ids.length ? await db.select().from(drugMaster).where(inArray(drugMaster.id, ids)) : []
  const runAt = new Date()
  const updates: { id: string; approvalNumber: string | null; approvalNumbers: string[] }[] = []
  for (const row of rows) {
    const draft = drafts.get(row.id)!
    const primary = draft.approvalNumbers.find((a) => !a.includes('分包装')) ?? draft.approvalNumbers[0] ?? null
    const sameApprovals = JSON.stringify(row.approvalNumbers ?? []) === JSON.stringify(draft.approvalNumbers)
    if (row.approvalNumber === primary && sameApprovals) continue
    updates.push({ id: row.id, approvalNumber: primary, approvalNumbers: draft.approvalNumbers })
  }
  console.log(`🔧 产品行批准文号同步 ${apply ? '· APPLY' : '· dry-run'}：待更新 ${updates.length} / 检查 ${rows.length}`)
  for (const u of updates) {
    console.log(`  ~ ${u.id}  → ${u.approvalNumbers.join('、')}`)
  }
  if (updates.length === 0) return 0
  if (!apply) {
    console.log('\n(dry-run：未落库；确认无误后加 --apply)')
    return 0
  }
  await db.transaction(async (tx) => {
    for (const u of updates) {
      const draft = drafts.get(u.id)!
      const identityKey = makeIdentityKey({
        genericName: draft.genericName,
        specification: draft.specification,
        form: draft.form,
        manufacturer: draft.manufacturer,
        approvalNumbers: draft.approvalNumbers,
      })
      await tx.update(drugMaster)
        .set({
          approvalNumber: u.approvalNumber,
          approvalNumbers: u.approvalNumbers,
          identityKey,
          updatedAt: runAt,
        })
        .where(eq(drugMaster.id, u.id))
    }
  })
  console.log('✅ 已落库')
  return 0
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const syncMaster = args.includes('--sync-master')
  const draftsDir = args.includes('--drafts') ? args[args.indexOf('--drafts') + 1] : undefined

  if (syncMaster) {
    if (!draftsDir) {
      console.error('用法：db:repair-specs -- --sync-master --drafts <dir> [--apply]')
      return 1
    }
    return syncMasterFields(draftsDir, apply)
  }

  const opsPath = args.includes('--ops') ? args[args.indexOf('--ops') + 1] : undefined
  if (!opsPath || !draftsDir) {
    console.error('用法：db:repair-specs -- --ops <repair-ops.json> --drafts <dir> [--apply]')
    console.error('      db:repair-specs -- --sync-master --drafts <dir> [--apply]')
    return 1
  }

  const ops = RepairOpsSchema.parse(JSON.parse(readFileSync(opsPath, 'utf8')))
  const drafts = loadDrafts(draftsDir)
  const ctx = await loadContext(ops, drafts)
  const plan = planRepair(ops, ctx)

  console.log(`🔧 规格修复 ${apply ? '· APPLY' : '· dry-run'}：${ops.ops.length} 条操作 / ${ops.pdfCount} 份 PDF`)
  console.log(`   计划步骤：删行 ${plan.counts.delete} / 改规格 ${plan.counts.updateSpec} / 改名 ${plan.counts.rename}（改产品行 ${plan.counts.moveMaster}、克隆 ${plan.counts.cloneMaster}）`)
  for (const step of plan.steps) {
    if (step.kind === 'delete-insert') console.log(`  - 删行 ${step.insertId}（${step.reason}）`)
    else if (step.kind === 'delete-master') console.log(`  - 删产品行 ${step.masterId}（已无说明书/用户引用）`)
    else if (step.kind === 'update-spec') console.log(`  ~ 改规格 ${step.insertId}  ${normalizeSpec(step.fromSpec)} → ${normalizeSpec(step.toSpec)}${step.reviewed ? '（reviewed，留审计）' : ''}`)
    else console.log(`  → 改名 ${step.fromDrugId} → ${step.toDrugId}  规格 ${normalizeSpec(step.toSpec)}${step.reviewed ? '（reviewed，留审计）' : ''}`)
  }
  if (plan.warnings.length) {
    console.log('\n⚠️ 警告：')
    plan.warnings.forEach((w) => console.log(`   ${w}`))
  }
  if (plan.errors.length) {
    console.error('\n❌ 校验失败，未执行任何写入：')
    plan.errors.forEach((e) => console.error(`   ${e}`))
    return 1
  }
  if (!apply) {
    console.log('\n(dry-run：未落库；确认无误后加 --apply)')
    return 0
  }
  await applyPlan(plan, ctx)
  console.log('\n✅ 已落库（单事务）')
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 修复失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
