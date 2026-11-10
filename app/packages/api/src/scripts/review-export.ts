/**
 * 说明书人工核对 · 批次导出（M6-T9）。
 *
 * 默认导出 curationStatus='crawled' 且带 sourceSections 的 PDF 说明书行；
 * --status reviewed 供已完成批次抽检（携带核对留档）。
 * 输出 JSON 供 tools/manual-pdf/review_page.py / spotcheck_page.py 生成离线审核页。
 *
 * 用法（cd app/packages/api）：
 *   npm run db:review-export -- --out ../../../data/review-batches/batch-01.json --limit 30
 *   npm run db:review-export -- --out ... --ids drug-a,drug-b
 *   npm run db:review-export -- --out ... --ids-file ids.txt --limit 30
 *   npm run db:review-export -- --out ... --ids-file ids.txt --status reviewed
 */
import 'dotenv/config'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import { drugMaster, packageInserts, sourceDocuments } from '../db/schema.js'
import { REQUIRED_SECTIONS } from '../services/review/decisions.js'

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

function joinArray(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join('\n')
  if (typeof value === 'string') return value
  return ''
}

function dosageRaw(value: unknown): string {
  if (value && typeof value === 'object' && 'raw' in value) return String((value as { raw: unknown }).raw ?? '')
  return ''
}

async function main(): Promise<number> {
  const outPath = arg('--out')
  if (!outPath) {
    console.error('❌ 缺少 --out <path>')
    return 1
  }
  const limit = Number(arg('--limit') ?? '30')
  const offset = Number(arg('--offset') ?? '0')
  if (!Number.isInteger(limit) || limit <= 0 || !Number.isInteger(offset) || offset < 0) {
    console.error('❌ --limit / --offset 非法')
    return 1
  }
  const statusArg = arg('--status') ?? 'crawled'
  if (statusArg !== 'crawled' && statusArg !== 'reviewed') {
    console.error('❌ --status 只能是 crawled 或 reviewed')
    return 1
  }
  const status = statusArg

  let ids: string[] = []
  const idsArg = arg('--ids')
  const idsFile = arg('--ids-file')
  if (idsArg) ids = idsArg.split(',').map((s) => s.trim()).filter(Boolean)
  if (idsFile) {
    ids = readFileSync(resolve(idsFile), 'utf8')
      .split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
  }

  const where = ids.length
    ? and(eq(packageInserts.curationStatus, status), isNotNull(packageInserts.sourceFile), inArray(packageInserts.drugId, ids))
    : and(eq(packageInserts.curationStatus, status), isNotNull(packageInserts.sourceFile))

  const rows = await db
    .select({ insert: packageInserts, master: drugMaster })
    .from(packageInserts)
    .innerJoin(drugMaster, eq(packageInserts.drugId, drugMaster.id))
    .where(where)
  const docs = new Map(
    (await db.select({
      id: sourceDocuments.id,
      metadata: sourceDocuments.metadata,
    }).from(sourceDocuments)).map((d) => [d.id, d]),
  )

  const pending = rows
    .filter((r) => r.insert.sourceSections && Object.keys(r.insert.sourceSections).length > 0)
    .sort((a, b) => (a.insert.genericName ?? '').localeCompare(b.insert.genericName ?? '', 'zh') || a.insert.id.localeCompare(b.insert.id))

  if (ids.length) {
    const found = new Set(pending.map((r) => r.insert.drugId))
    const missing = ids.filter((id) => !found.has(id))
    if (missing.length) {
      console.error(`❌ 以下 drugId 不是可核对的 ${status} 行：${missing.join(', ')}`)
      return 1
    }
  }

  const batch = pending.slice(offset, offset + limit)
  if (batch.length === 0) {
    console.error(`❌ 批次为空（${status} 可核对 ${pending.length} 行，offset=${offset}）`)
    return 1
  }

  const items = batch.map((r) => {
    const insert = r.insert
    const master = r.master
    const metadata = (insert.sourceDocumentId ? docs.get(insert.sourceDocumentId)?.metadata : null) as
      | Record<string, unknown>
      | null
      | undefined
    return {
      insertId: insert.id,
      drugId: insert.drugId,
      version: insert.version,
      sourceFile: insert.sourceFile,
      sourceDocumentId: insert.sourceDocumentId,
      contentHash: insert.contentHash,
      pageCount: metadata?.pageCount ?? null,
      extractorVersion: metadata?.extractorVersion ?? null,
      identity: {
        genericName: insert.genericName,
        brandName: insert.brandName,
        form: insert.form,
        specification: insert.specification,
        manufacturer: master.manufacturer,
        approvalNumbers: master.approvalNumbers ?? insert.approvalNumbers ?? [],
        productType: master.productType,
      },
      mapped: {
        indication: insert.indication ?? '',
        contraindication: joinArray(insert.contraindications),
        precautions: joinArray(insert.precautions),
        adverse: insert.adverseReactions ?? '',
        interactions: insert.interactions ?? '',
        dosage: dosageRaw(insert.dosage),
      },
      sourceSections: insert.sourceSections ?? {},
      review: status === 'reviewed'
        ? {
            reviewedBy: insert.reviewedBy,
            reviewedAt: insert.reviewedAt,
            reviewMeta: insert.reviewMeta,
          }
        : null,
    }
  })

  const payload = {
    schemaVersion: 1,
    batchId: `review-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`,
    generatedAt: new Date().toISOString(),
    status,
    requiredSections: REQUIRED_SECTIONS,
    totalPending: pending.length,
    offset,
    limit,
    items,
  }
  const absolute = resolve(outPath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  const byType = new Map<string, number>()
  for (const item of items) {
    const key = item.identity.productType ?? '未标注'
    byType.set(key, (byType.get(key) ?? 0) + 1)
  }
  console.log(`✅ 导出 ${items.length} 行（${status} 可核对 ${pending.length} 行，offset=${offset}）`)
  console.log(`   类型：${[...byType].map(([k, v]) => `${k} ${v}`).join(' / ')}`)
  console.log(`   文件：${absolute}`)
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 导出失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
