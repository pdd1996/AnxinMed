/**
 * M8-T3 · DXY 15 行回填：data/crawled/*.json → package_inserts.source_sections/content_hash。
 *
 * 为什么需要：丁香园来源行入库时只映射字段列，source_sections 为空、content_hash 为 NULL，
 * 导致 review-export 导不出、无法做「映射列 ↔ 原文段」核对。回填后 DXY 行走与 PDF 行同一套
 * 核对流程（M6/M7 的 review-export / review-apply）。
 *
 * 用法（cd app/packages/api）：
 *   npm run db:backfill-dxy-sections -- --dry-run     # 默认；只打印计划
 *   npm run db:backfill-dxy-sections -- --apply       # 单事务落库
 *   npm run db:backfill-dxy-sections -- --apply --drafts ../data/crawled
 *
 * 安全：只动 crawled 的丁香园行；reviewed 行拒绝；已有非空 sections 且不一致 → 整批不落库。
 */
import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, like } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import { packageInserts } from '../db/schema.js'
import { planDxyBackfill, type DxyDraft } from '../services/review/dxy-backfill.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply')
  const draftsDir = resolve(arg('--drafts') ?? join(repoRoot, 'data', 'crawled'))

  let files: string[]
  try {
    files = readdirSync(draftsDir).filter((f) => f.endsWith('.json')).sort()
  } catch (err) {
    console.error(`❌ 读不到草稿目录 ${draftsDir}：${(err as Error).message}`)
    return 1
  }
  if (files.length === 0) {
    console.error(`❌ 草稿目录为空：${draftsDir}`)
    return 1
  }

  const drafts: DxyDraft[] = []
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(draftsDir, file), 'utf8')) as {
      drugId?: string
      version?: string
      sourceUrl?: string | null
      sections?: Record<string, string>
    }
    if (!raw.drugId || !raw.version || !raw.sections) {
      console.error(`❌ 草稿缺字段（drugId/version/sections）：${file}`)
      return 1
    }
    drafts.push({ drugId: raw.drugId, version: raw.version, sourceUrl: raw.sourceUrl ?? null, sections: raw.sections })
  }

  const rows = await db
    .select({
      id: packageInserts.id,
      drugId: packageInserts.drugId,
      source: packageInserts.source,
      version: packageInserts.version,
      sourceUrl: packageInserts.sourceUrl,
      curationStatus: packageInserts.curationStatus,
      sourceSections: packageInserts.sourceSections,
      contentHash: packageInserts.contentHash,
      curationNote: packageInserts.curationNote,
    })
    .from(packageInserts)
    .where(like(packageInserts.source, '%丁香园%'))

  console.log(`📚 草稿 ${drafts.length} 份 · 库内丁香园行 ${rows.length} 行`)
  const plan = planDxyBackfill(drafts, rows)
  for (const w of plan.warnings) console.warn(`⚠️  ${w}`)
  if (plan.errors.length > 0) {
    console.error(`\n❌ 规划失败 ${plan.errors.length} 条（整批不落库）：`)
    for (const e of plan.errors) console.error(`   - ${e}`)
    return 1
  }

  console.log(`\n计划：更新 ${plan.updates.length} / 未变 ${plan.unchanged.length}`)
  for (const u of plan.updates) console.log(`  ~ ${u.drugId.padEnd(32)} ${u.insertId}  hash=${u.contentHash.slice(0, 12)}…`)

  if (!apply) {
    console.log('\n🔍 dry-run 结束，未落库（加 --apply 执行）')
    return 0
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    for (const u of plan.updates) {
      await tx
        .update(packageInserts)
        .set({
          sourceSections: u.sections,
          contentHash: u.contentHash,
          curationNote: u.curationNote,
          updatedAt: now,
        })
        .where(eq(packageInserts.id, u.insertId))
    }
  })
  console.log(`\n✅ 已回填 ${plan.updates.length} 行（单事务）`)
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 回填失败（事务已回滚）:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
