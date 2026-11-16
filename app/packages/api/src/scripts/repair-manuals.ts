/**
 * 说明书内容修复 · 落库脚本（M7-T5，2026-11-15）
 *
 * 解析器与校验在 services/review/manual-repair.ts（纯函数，可单测）；本文件只做 I/O：
 * 读 staging 草稿 → 载入库内快照 → 规划 → dry-run 打印 / --apply 单事务执行。
 *
 * 用法（在 app/ 下执行）：
 *   pnpm --filter @anxin/api db:repair-manuals -- --drafts ../../data/manuals-incoming-m7          # dry-run
 *   pnpm --filter @anxin/api db:repair-manuals -- --drafts ../../data/manuals-incoming-m7 --apply
 *
 * 覆盖范围（只动 PDF 来源的说明书行，丁香园 15 行不在 M7 范围）：
 * - 行内容：source_sections / 映射内容列 / content_hash / brand_name / approval_numbers / specification；
 * - 产品行：brand_name / approval_number(s) / specification / identity_key（指纹撞车整批拒绝）；
 * - reviewed 行：不降级，写 manual_review_log action='correct'（diff 记段落长度与变化字段）；
 * - 重提取后不再产出的旧行：非 reviewed 才删（reviewed 拒绝并报错）。
 * 新行与 source_documents 刷新交给 db:import-manuals（本脚本只打印提示）。
 */
import 'dotenv/config'
import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import { ManualDraftSchema, type Draft } from '../db/manual-draft.js'
import { drugMaster, drugs, interactionRules, manualReviewLog, packageInserts } from '../db/schema.js'
import {
  draftKey,
  planManualRepair,
  type InsertLite,
  type MasterLite,
  type RepairContext,
} from '../services/review/manual-repair.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')
const repairLogPath = join(repoRoot, 'data', 'import-log.jsonl')
const REVIEWER = 'm7-reextract-2026-11-15'
const REASON = 'M7 重提取修复：表格行列重建 / 批准文号按规格归属 / 商品名标签变体'

function loadDrafts(dir: string): Draft[] {
  const drafts: Draft[] = []
  const errors: string[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const parsed = ManualDraftSchema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')))
    if (!parsed.success) {
      errors.push(`${file}: 草稿校验失败 — ${parsed.error.issues.map((i) => i.message).join('; ')}`)
      continue
    }
    drafts.push(parsed.data)
  }
  if (errors.length) {
    throw new Error(`修正草稿校验失败（${errors.length} 份）：\n${errors.slice(0, 20).join('\n')}`)
  }
  return drafts
}

async function loadContext(): Promise<RepairContext> {
  const rows = await db.select().from(packageInserts)
  const masters = await db.select().from(drugMaster)
  const userRefRows = await db.select({ drugMasterId: drugs.drugMasterId }).from(drugs)
  const ruleRows = await db.select({ drugIds: interactionRules.drugIds }).from(interactionRules)

  const insertsById = new Map<string, InsertLite>()
  const insertsByKey = new Map<string, InsertLite>()
  for (const row of rows) {
    // 整行带进规划器：内容列（含 curationNote/genericName）都要参与 diff，否则会漏更新
    const lite: InsertLite = {
      ...(row as unknown as Record<string, unknown>),
      id: row.id,
      drugId: row.drugId,
      sourceFile: row.sourceFile,
      sourceDocumentId: row.sourceDocumentId,
      version: row.version,
      curationStatus: row.curationStatus,
      specification: row.specification,
      brandName: row.brandName,
      approvalNumbers: (row.approvalNumbers as string[] | null) ?? null,
      sourceSections: (row.sourceSections as Record<string, string> | null) ?? null,
    }
    insertsById.set(lite.id, lite)
    if (lite.sourceFile) insertsByKey.set(draftKey(lite.drugId, lite.sourceFile), lite)
  }

  const masterMap = new Map<string, MasterLite>()
  for (const m of masters) {
    masterMap.set(m.id, {
      id: m.id,
      identityKey: m.identityKey,
      curationStatus: m.curationStatus,
      brandName: m.brandName,
      specification: m.specification,
      approvalNumber: m.approvalNumber,
      approvalNumbers: (m.approvalNumbers as string[] | null) ?? null,
    })
  }

  const userRefs = new Map<string, number>()
  for (const r of userRefRows) {
    if (r.drugMasterId) userRefs.set(r.drugMasterId, (userRefs.get(r.drugMasterId) ?? 0) + 1)
  }
  const ruleRefs = new Map<string, number>()
  for (const r of ruleRows) {
    for (const id of (r.drugIds ?? []) as string[]) {
      ruleRefs.set(id, (ruleRefs.get(id) ?? 0) + 1)
    }
  }
  return { insertsByKey, insertsById, masters: masterMap, userRefs, ruleRefs }
}

async function applyPlan(ctx: RepairContext, plan: ReturnType<typeof planManualRepair>): Promise<void> {
  const runAt = new Date()
  await db.transaction(async (tx) => {
    for (const update of plan.updates) {
      await tx.update(packageInserts)
        .set({ ...update.values, updatedAt: runAt })
        .where(eq(packageInserts.id, update.insertId))
      if (update.reviewed) {
        await tx.insert(manualReviewLog).values({
          insertId: update.insertId,
          action: 'correct',
          reviewer: REVIEWER,
          diff: {
            kind: 'content-repair',
            reason: REASON,
            drugId: update.drugId,
            sourceFile: update.sourceFile,
            changedFields: update.changedFields,
            changedSections: update.changedSections,
            identityKey: update.identityKey.slice(0, 16),
            reviewedPreserved: true,
          },
        })
      }
    }
    for (const master of plan.masterUpdates) {
      await tx.update(drugMaster)
        .set({ ...master.fields, updatedAt: runAt })
        .where(eq(drugMaster.id, master.masterId))
    }
    const deletedIds = new Set<string>()
    for (const step of plan.deletes) {
      await tx.delete(packageInserts).where(eq(packageInserts.id, step.insertId))
      deletedIds.add(step.drugId)
    }
    // 产品行清理：只有当该产品行已无说明书行、且无用户药箱/规则引用时才删
    for (const masterId of deletedIds) {
      const stillUsed = [...ctx.insertsById.values()].some(
        (r) => r.drugId === masterId && !plan.deletes.some((d) => d.insertId === r.id),
      )
      if (stillUsed) continue
      if ((ctx.userRefs.get(masterId) ?? 0) > 0 || (ctx.ruleRefs.get(masterId) ?? 0) > 0) continue
      await tx.delete(drugMaster).where(eq(drugMaster.id, masterId))
    }
  })

  appendFileSync(repairLogPath, `${JSON.stringify({
    runAt: runAt.toISOString(),
    run: 'manual-repair-m7',
    counts: plan.counts,
  })}\n`)
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const draftsDir = args.includes('--drafts') ? args[args.indexOf('--drafts') + 1] : undefined
  if (!draftsDir) {
    console.error('用法：db:repair-manuals -- --drafts <dir> [--apply]')
    return 1
  }

  const drafts = loadDrafts(draftsDir)
  const ctx = await loadContext()
  const plan = planManualRepair(drafts, ctx)

  console.log(`🔧 说明书内容修复 ${apply ? '· APPLY' : '· dry-run'}：草稿 ${drafts.length} 份`)
  console.log(`   计划：更新行 ${plan.counts.update}（其中 reviewed ${plan.counts.reviewedUpdate}）`
    + ` / 产品行同步 ${plan.counts.masterUpdate} / 删行 ${plan.counts.delete} / 新行 ${plan.counts.newDraft} / 未变 ${plan.counts.unchanged}`)

  for (const update of plan.updates.slice(0, 30)) {
    const sections = Object.entries(update.changedSections)
      .map(([name, c]) => `${name}(${c.beforeLen}→${c.afterLen}${c.hasTable ? '·表' : ''})`)
      .join(' ')
    console.log(`  ~ ${update.insertId}${update.reviewed ? '（reviewed，留审计）' : ''}  字段 ${update.changedFields.join(',')}`)
    if (sections) console.log(`      段落 ${sections}`)
  }
  if (plan.updates.length > 30) console.log(`  … 其余 ${plan.updates.length - 30} 行见报告`)
  for (const step of plan.deletes) {
    console.log(`  - 删行 ${step.insertId}（${step.reason}）`)
  }
  for (const draft of plan.newDrafts.slice(0, 20)) {
    console.log(`  + 新行 ${draft.drugId}（${draft.sourceFile}）→ 交给 db:import-manuals`)
  }
  if (plan.newDrafts.length > 20) console.log(`  … 其余 ${plan.newDrafts.length - 20} 份新草稿`)

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
  await applyPlan(ctx, plan)
  console.log('\n✅ 已落库（单事务）')
  if (plan.newDrafts.length) {
    console.log(`   还有 ${plan.newDrafts.length} 份新草稿：请执行 db:import-manuals -- --dir <drafts> --apply 入库`)
  }
  console.log('   建议随后执行 db:import-manuals -- --dir <drafts> --apply 刷新 source_documents 内容哈希')
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 修复失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
