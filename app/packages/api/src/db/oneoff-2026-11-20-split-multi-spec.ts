/**
 * 一次性迁移（2026-11-20）——多规格合并行拆行 + 单规格行批号收窄。
 *
 * 背景：`阿利沙坦酯片` 80mg/240mg 被 PDF 抽取合并成一行，approval_number 只取第一个，
 * 拍 240mg 药盒会配到 80mg 的批号（docs/specs/26-身份卡批准文号口径.md）。
 * 干跑清单：data/split-dryrun-2026-11-20/（23 条可拆 / 60 个目标行 + 22 条收窄）。
 *
 * 安全设计：
 * - 默认 dry-run，只读、只打印；`--apply` 才写库，且必须提供 48h 内的 pg_dump 文件；
 * - 全流程单事务；迁移后在同一事务内跑 `verifyMigration`，任何一条不通过 → 回滚；
 * - 源行规格/批号与 manifest 不一致（库已漂移）→ 预检直接中止，不猜；
 * - 原 id 保留给第一个规格；用户档案按 `drugs.specification` 的强度改指向；
 * - interaction_rules 里引用原 id 的扩成全部规格 id，避免拆完后 240mg 用户漏检相互作用；
 * - package_inserts 跟随拆行复制，保证每个规格都能取到说明书。
 *
 * 用法（在 app/packages/api 下）：
 *   pnpm db:split-multi-spec                                      # dry-run
 *   pnpm db:split-multi-spec -- --verify                          # 只读校验（迁移后）
 *   pg_dump "$DATABASE_URL" -Fc -f ../../backups/anxin-pre-split-20261120.dump
 *   pnpm db:split-multi-spec -- --apply --backup ../../backups/anxin-pre-split-20261120.dump
 *
 * 回滚：
 *   pg_restore -d "$DATABASE_URL" --clean --if-exists <dump>
 */
import '../lib/env.js'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, inArray } from 'drizzle-orm'
import { db, client, type Executor } from './client.js'
import { drugMaster, drugs, interactionRules, packageInserts } from './schema.js'
import {
  buildSplitPlan,
  isFlaggedMaster,
  SplitPlanError,
  verifyMigration,
  type InsertRow,
  type MasterRow,
  type RuleRow,
  type Snapshot,
  type SplitManifest,
  type UserDrugRow,
} from './split-multi-spec-plan.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MANIFEST = join(__dirname, 'manifests', 'split-multi-spec-2026-11-20.json')
const BACKUP_MAX_AGE_MS = 48 * 60 * 60 * 1000

interface Args {
  apply: boolean
  verify: boolean
  manifest: string
  backup: string | null
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, verify: false, manifest: DEFAULT_MANIFEST, backup: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') continue
    if (arg === '--apply') args.apply = true
    else if (arg === '--verify') args.verify = true
    else if (arg === '--manifest') args.manifest = resolve(argv[++i] ?? '')
    else if (arg === '--backup') args.backup = resolve(argv[++i] ?? '')
    else if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    } else {
      console.error(`未知参数：${arg}`)
      printUsage()
      process.exit(2)
    }
  }
  if (args.apply && args.verify) {
    console.error('--apply 与 --verify 不能同时使用')
    process.exit(2)
  }
  return args
}

function printUsage(): void {
  console.log(`
多规格拆行迁移（dry-run 为默认）

  tsx src/db/oneoff-2026-11-20-split-multi-spec.ts                  # dry-run（只读）
  tsx src/db/oneoff-2026-11-20-split-multi-spec.ts --verify         # 迁移后只读校验
  tsx src/db/oneoff-2026-11-20-split-multi-spec.ts --apply --backup <dump 文件>

--apply 要求 48 小时内生成的 pg_dump（-Fc），否则拒绝执行。
`)
}

function loadManifest(path: string): SplitManifest {
  if (!existsSync(path)) throw new Error(`manifest 不存在：${path}`)
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as SplitManifest
  if (!Array.isArray(manifest.splits) || !Array.isArray(manifest.narrows)) {
    throw new Error('manifest 结构不合法：缺少 splits / narrows')
  }
  return manifest
}

async function loadSnapshot(exec: Executor): Promise<Snapshot> {
  const masters = await exec
    .select({
      id: drugMaster.id,
      genericName: drugMaster.genericName,
      brandName: drugMaster.brandName,
      specification: drugMaster.specification,
      form: drugMaster.form,
      manufacturer: drugMaster.manufacturer,
      approvalNumber: drugMaster.approvalNumber,
      approvalNumbers: drugMaster.approvalNumbers,
      identityKey: drugMaster.identityKey,
      note: drugMaster.note,
    })
    .from(drugMaster)

  const inserts = await exec
    .select({
      id: packageInserts.id,
      drugId: packageInserts.drugId,
      specification: packageInserts.specification,
      approvalNumbers: packageInserts.approvalNumbers,
      curationNote: packageInserts.curationNote,
    })
    .from(packageInserts)

  const userDrugs = await exec
    .select({ id: drugs.id, drugMasterId: drugs.drugMasterId, specification: drugs.specification })
    .from(drugs)

  const ruleRows = await exec
    .select({ id: interactionRules.id, drugIds: interactionRules.drugIds, drugGroups: interactionRules.drugGroups })
    .from(interactionRules)

  return {
    masters: masters as MasterRow[],
    inserts: inserts as InsertRow[],
    userDrugs: userDrugs as UserDrugRow[],
    rules: ruleRows.map((r) => ({
      id: r.id,
      drugIds: Array.isArray(r.drugIds) ? (r.drugIds as string[]) : [],
      drugGroups: (r.drugGroups as string[][] | null) ?? null,
    })) as RuleRow[],
  }
}

function checkBackup(path: string | null): string {
  if (!path) {
    throw new Error(
      '--apply 必须提供 --backup <pg_dump 文件>。示例（在 app/packages/api 下）：\n' +
        '  pg_dump "$DATABASE_URL" -Fc -f ../../backups/anxin-pre-split-20261120.dump',
    )
  }
  if (!existsSync(path)) throw new Error(`备份文件不存在：${path}`)
  const stat = statSync(path)
  if (stat.size === 0) throw new Error(`备份文件为空：${path}`)
  const age = Date.now() - stat.mtimeMs
  if (age > BACKUP_MAX_AGE_MS) {
    throw new Error(`备份文件超过 48 小时（${(age / 3600_000).toFixed(1)}h），请重新 pg_dump：${path}`)
  }
  return path
}

function printPlan(plan: ReturnType<typeof buildSplitPlan>): void {
  const s = plan.stats
  console.log(
    `拆行 ${s.splits} 条 → ${s.targets} 行；批号收窄 ${s.narrows} 条；标记行 ${s.flaggedBefore} → ${s.flaggedAfter}`,
  )
  console.log(
    `待写：drug_master 更新 ${plan.masterUpdates.length} / 新增 ${plan.masterInserts.length}；` +
      `package_inserts 更新 ${plan.insertUpdates.length} / 复制 ${plan.insertClones.length}；` +
      `用户档案改指向 ${plan.userDrugUpdates.length}；相互作用规则扩写 ${plan.ruleUpdates.length}`,
  )
  for (const u of plan.userDrugUpdates) console.log(`  drugs ${u.id}: ${u.from} → ${u.to}`)
  for (const r of plan.ruleUpdates) console.log(`  rule ${r.id}: drugIds=[${r.drugIds.join(', ')}]`)
  for (const w of plan.warnings) console.warn(`  ⚠️ ${w}`)
}

async function executePlan(exec: Executor, plan: ReturnType<typeof buildSplitPlan>): Promise<void> {
  const now = new Date()

  // 1) 先把要改指纹的行挪到临时 key，避免交换/占用撞唯一索引
  for (const patch of plan.masterUpdates) {
    await exec.update(drugMaster).set({ identityKey: `tmp-split-${patch.id}` }).where(eq(drugMaster.id, patch.id))
  }

  // 2) 原行改成第一个规格
  for (const patch of plan.masterUpdates) {
    await exec
      .update(drugMaster)
      .set({
        specification: patch.specification,
        approvalNumber: patch.approvalNumber,
        approvalNumbers: patch.approvalNumbers,
        identityKey: patch.identityKey,
        note: patch.note,
        updatedAt: now,
      })
      .where(eq(drugMaster.id, patch.id))
  }

  // 3) 新增规格行：复制源行全部字段，只覆盖身份/批号/备注
  if (plan.masterInserts.length) {
    const sourceIds = [...new Set(plan.masterInserts.map((p) => p.sourceId))]
    const sourceRows = await exec.select().from(drugMaster).where(inArray(drugMaster.id, sourceIds))
    const byId = new Map(sourceRows.map((r) => [r.id, r]))
    for (const patch of plan.masterInserts) {
      const source = byId.get(patch.sourceId)
      if (!source) throw new Error(`新增行找不到源行：${patch.sourceId}`)
      const { id: _id, createdAt: _created, updatedAt: _updated, ...rest } = source
      await exec.insert(drugMaster).values({
        ...rest,
        id: patch.id,
        specification: patch.specification,
        approvalNumber: patch.approvalNumber,
        approvalNumbers: patch.approvalNumbers,
        identityKey: patch.identityKey,
        note: patch.note,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  // 4) 说明书：原行更新
  for (const patch of plan.insertUpdates) {
    await exec
      .update(packageInserts)
      .set({
        specification: patch.specification,
        approvalNumbers: patch.approvalNumbers,
        curationNote: patch.note,
        updatedAt: now,
      })
      .where(eq(packageInserts.id, patch.id))
  }

  // 5) 说明书：按规格复制
  if (plan.insertClones.length) {
    const sourceInsertIds = [...new Set(plan.insertClones.map((c) => c.sourceInsertId))]
    const sourceRows = await exec.select().from(packageInserts).where(inArray(packageInserts.id, sourceInsertIds))
    const byId = new Map(sourceRows.map((r) => [r.id, r]))
    for (const clone of plan.insertClones) {
      const source = byId.get(clone.sourceInsertId)
      if (!source) throw new Error(`复制说明书找不到源行：${clone.sourceInsertId}`)
      const { id: _id, createdAt: _created, updatedAt: _updated, ...rest } = source
      await exec.insert(packageInserts).values({
        ...rest,
        id: randomUUID(),
        drugId: clone.newDrugId,
        specification: clone.specification,
        approvalNumbers: clone.approvalNumbers,
        curationNote: clone.note,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  // 6) 用户档案改指向
  for (const patch of plan.userDrugUpdates) {
    await exec.update(drugs).set({ drugMasterId: patch.to, updatedAt: now }).where(eq(drugs.id, patch.id))
  }

  // 7) 相互作用规则扩写
  for (const patch of plan.ruleUpdates) {
    await exec
      .update(interactionRules)
      .set({ drugIds: patch.drugIds, drugGroups: patch.drugGroups, updatedAt: now })
      .where(eq(interactionRules.id, patch.id))
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const manifest = loadManifest(args.manifest)
  console.log(`manifest：${args.manifest}（${manifest.date}，拆行 ${manifest.splits.length} / 收窄 ${manifest.narrows.length}）`)

  if (args.verify) {
    const snapshot = await loadSnapshot(db)
    const issues = verifyMigration(snapshot, manifest)
    if (issues.length) {
      console.error(`\n❌ 校验未通过（${issues.length} 项）：`)
      for (const issue of issues) console.error(`  - ${issue}`)
      return 1
    }
    console.log('\n✅ 校验通过：拆行目标规格/批号正确、无重复指纹、说明书齐全')
    const flagged = snapshot.masters.filter(isFlaggedMaster).length
    console.log(`当前标记行 ${flagged}（manifest 期望 ${manifest.expectedFlaggedAfter ?? '—'}）`)
    if (manifest.expectedFlaggedAfter !== undefined && flagged !== manifest.expectedFlaggedAfter) {
      console.warn('  ⚠️ 与 manifest 期望不一致：真实库可能比 1589 份草稿影子多/少行，按实际库为准')
    }
    return 0
  }

  if (!args.apply) {
    const snapshot = await loadSnapshot(db)
    const plan = buildSplitPlan(snapshot, manifest)
    printPlan(plan)
    console.log('\nDRY-RUN：未写库。加 --apply --backup <pg_dump 文件> 执行。')
    return 0
  }

  const backup = checkBackup(args.backup)
  console.log(`备份：${backup}（${(statSync(backup).size / 1024 / 1024).toFixed(1)} MB）`)

  await db.transaction(async (tx) => {
    const snapshot = await loadSnapshot(tx)
    const plan = buildSplitPlan(snapshot, manifest)
    printPlan(plan)
    await executePlan(tx, plan)

    const after = await loadSnapshot(tx)
    const issues = verifyMigration(after, manifest)
    if (issues.length) {
      throw new Error(`迁移后校验失败（${issues.length} 项）：\n${issues.map((x) => `  - ${x}`).join('\n')}`)
    }
  })

  console.log('\n✅ 迁移已提交，且事务内校验通过')
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`)
    if (err instanceof SplitPlanError) {
      for (const issue of err.issues) console.error(`  - ${issue}`)
    }
    await client.end().catch(() => undefined)
    process.exit(1)
  })
