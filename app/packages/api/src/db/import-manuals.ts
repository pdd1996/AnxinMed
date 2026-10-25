/**
 * 说明书 PDF 草稿导入 —— data/manuals/*.json → package_inserts（+ 为缺失的 drug 建 crawled 档）
 *
 * 用法：
 *   npm run db:import-manuals                # 导入全部草稿（幂等，可重复运行）
 *   npm run db:import-manuals -- --dry-run   # 只打印将执行的动作（事务内执行后回滚），不落库、不记日志
 *   npm run db:import-manuals -- --status    # 草稿 ↔ 数据库对账
 *
 * 语义与 import-crawled 一致：
 * - 草稿以 curationStatus='crawled' 入库（staging），人工核对后才可升 reviewed；
 * - 幂等以（drugId, version）为逻辑键；同版本已有 mock/reviewed 行 → 跳过不覆盖；
 * - drug_master 已有行不动，缺失才自动建档；
 * - 完整原文分段写入 source_sections，source_file/source_record_ids/approval_numbers 留痕。
 */
import 'dotenv/config'
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { and, eq, TransactionRollbackError } from 'drizzle-orm'
import { z } from 'zod'
import { db, client } from './client.js'
import { fallbackContentHash, makeGenericId, makeIdentityKey, makeSourceDocumentId } from './identity.js'
import { drugGenerics, drugMaster, packageInserts, sourceDocuments, PRODUCT_TYPES } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')
const manualsDir = join(repoRoot, 'data', 'manuals')
const importLogPath = join(repoRoot, 'data', 'import-log.jsonl')

const ManualDraftSchema = z
  .object({
    source: z.literal('manual-pdf'),
    sourceFile: z.string().min(1),
    sourceRecordIds: z.array(z.string()).default([]),
    extractedAt: z.string().min(1),
    pdfCreatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    extractorVersion: z.string().nullable().default(null),
    pageCount: z.number().int().positive().nullable().default(null),
    sourceFileHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
    drugId: z.string().regex(/^drug-[a-z0-9]+(-[a-z0-9]+)*$/, 'drugId 须为 drug-* 小写连字符形式'),
    genericName: z.string().min(1),
    brandName: z.string().nullable().default(null),
    englishName: z.string().nullable().default(null),
    pinyin: z.string().nullable().default(null),
    form: z.string().min(1),
    productType: z.enum(PRODUCT_TYPES).nullable().default(null),
    specification: z.string().min(1),
    approvalNumbers: z.array(z.string()).default([]),
    manufacturer: z.string().nullable().default(null),
    repackager: z.string().nullable().default(null),
    executionStandard: z.string().nullable().default(null),
    shelfLife: z.string().nullable().default(null),
    version: z.string().regex(/^(nmpa|pdf)-.+$/, 'version 须为 nmpa-* 或 pdf-*'),
    sections: z.record(z.string()),
    curationStatus: z.literal('crawled'),
    curationNote: z.string().default(''),
  })
  .refine((d) => Object.keys(d.sections).length > 0, { message: 'sections 不能为空' })

type Draft = z.infer<typeof ManualDraftSchema>

const MAPPED_COLUMNS = [
  'genericName', 'brandName', 'form', 'specification',
  'indication', 'components', 'dosage', 'contraindications', 'adverseReactions', 'precautions',
  'interactions', 'pharmacology', 'pharmacokinetics', 'storage', 'afterOpeningDays',
  'source', 'version', 'sourceUrl', 'sourceDocumentId', 'contentHash', 'sourceSections', 'sourceFile',
  'sourceRecordIds', 'approvalNumbers', 'curationNote',
] as const

type MappedColumn = (typeof MAPPED_COLUMNS)[number]

interface MappedInsertValues {
  genericName: string
  brandName: string | null
  form: string | null
  specification: string | null
  indication: string | null
  components: string | null
  dosage: unknown
  contraindications: unknown
  adverseReactions: string | null
  precautions: unknown
  interactions: string | null
  pharmacology: string | null
  pharmacokinetics: string | null
  storage: string | null
  afterOpeningDays: number | null
  source: string | null
  version: string | null
  sourceUrl: string | null
  sourceDocumentId: string
  contentHash: string
  sourceSections: Record<string, string>
  sourceFile: string
  sourceRecordIds: string[]
  approvalNumbers: string[]
  curationNote: string | null
}

function buildSource(d: Draft): string {
  return `说明书 PDF（本地资料库${d.pdfCreatedAt ? `，PDF 批次 ${d.pdfCreatedAt}` : ''}）`
}

function mapDraftToInsertValues(d: Draft, sourceDocumentId: string, contentHash: string): MappedInsertValues {
  return {
    genericName: d.genericName,
    brandName: d.brandName,
    form: d.form,
    specification: d.specification,
    indication: d.sections['适应症'] ?? null,
    components: d.sections['成份'] ?? null,
    dosage: d.sections['用法用量'] ? { raw: d.sections['用法用量'] } : null,
    contraindications: d.sections['禁忌'] ? [d.sections['禁忌']] : null,
    adverseReactions: d.sections['不良反应'] ?? null,
    precautions: d.sections['注意事项'] ? [d.sections['注意事项']] : null,
    interactions: d.sections['药物相互作用'] ?? null,
    pharmacology: d.sections['药理毒理'] ?? d.sections['药理作用'] ?? null,
    pharmacokinetics: d.sections['药代动力学'] ?? null,
    storage: d.sections['贮藏'] ?? null,
    afterOpeningDays: null,
    source: buildSource(d),
    version: d.version,
    sourceUrl: null,
    sourceDocumentId,
    contentHash,
    sourceSections: d.sections,
    sourceFile: d.sourceFile,
    sourceRecordIds: d.sourceRecordIds,
    approvalNumbers: d.approvalNumbers,
    curationNote: d.curationNote,
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  // jsonb 会重排对象键，字符串比较会把同内容误判为变化
  return isDeepStrictEqual(a, b)
}

function mappedDiff(values: MappedInsertValues, row: Record<string, unknown>): string[] {
  return MAPPED_COLUMNS.filter((k) => !jsonEqual(values[k as MappedColumn], row[k]))
}

interface DrugMasterLite {
  id: string
  genericName: string
  brandName: string | null
  form: string | null
  specification: string
  curationStatus: string
  identityKey: string | null
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const statusOnly = args.includes('--status')

  let files: string[]
  try {
    files = readdirSync(manualsDir).filter((f) => f.endsWith('.json')).sort()
  } catch {
    console.error(`❌ 未找到草稿目录：${manualsDir}`)
    return 1
  }
  if (files.length === 0) {
    console.error(`❌ 未找到草稿：${manualsDir}/*.json`)
    return 1
  }

  const drafts: { file: string; draft: Draft }[] = []
  const errors: string[] = []
  const seenDrugIds = new Set<string>()
  for (const file of files) {
    const path = join(manualsDir, file)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (e) {
      errors.push(`${file}: JSON 解析失败 — ${(e as Error).message}`)
      continue
    }
    const result = ManualDraftSchema.safeParse(parsed)
    if (!result.success) {
      errors.push(`${file}: 草稿校验失败 — ${result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
      continue
    }
    if (seenDrugIds.has(result.data.drugId)) {
      errors.push(`${file}: drugId ${result.data.drugId} 与其他草稿重复`)
      continue
    }
    seenDrugIds.add(result.data.drugId)
    drafts.push({ file, draft: result.data })
  }

  const masterRows = await db.select().from(drugMaster)
  const masters = new Map<string, DrugMasterLite>(masterRows.map((r) => [r.id, {
    id: r.id,
    genericName: r.genericName,
    brandName: r.brandName,
    form: r.form,
    specification: r.specification,
    curationStatus: r.curationStatus,
    identityKey: r.identityKey,
  }]))
  const masterByIdentity = new Map(
    masterRows.filter((r) => r.identityKey).map((r) => [r.identityKey as string, r.id]),
  )
  const insertRows = await db.select().from(packageInserts)

  if (statusOnly) {
    console.log(`📋 PDF 草稿 ↔ 数据库对账（草稿 ${drafts.length} 份，校验失败 ${errors.length} 份）\n`)
    for (const { draft } of drafts) {
      const identityKey = makeIdentityKey(draft)
      const masterId = masters.has(draft.drugId)
        ? draft.drugId
        : (masterByIdentity.get(identityKey) ?? draft.drugId)
      const master = masters.get(masterId)
      const existing = insertRows.find((r) => r.drugId === masterId && r.version === draft.version)
      const masterState = master ? `master=${master.curationStatus}` : 'master=缺失（导入时自动建档）'
      const insertState = existing
        ? `说明书=已入库（${existing.curationStatus}，${existing.id}）`
        : '说明书=未入库'
      console.log(`  ${draft.drugId.padEnd(40)} ${draft.version}  ${masterState}  ${insertState}`)
    }
    console.log(`\n   数据库现存：drug_master ${masterRows.length} 行，package_inserts ${insertRows.length} 行`)
    if (errors.length) {
      console.error('\n⚠️ 校验失败的草稿：')
      errors.forEach((e) => console.error(`   ${e}`))
    }
    return errors.length > 0 ? 1 : 0
  }

  console.log(`📥 导入说明书 PDF 草稿（${drafts.length} 份，校验失败 ${errors.length} 份）${dryRun ? ' · dry-run' : ''}\n`)

  const runAt = new Date().toISOString()
  const results: { draft: Draft; insert: string; master: string; reason?: string }[] = []
  const seenInsertKeys = new Set<string>()

  for (const { draft } of drafts) {
    const d = draft
    let insertMsg = ''
    let masterMsg = ''
    let reason: string | undefined
    const identityKey = makeIdentityKey(d)
    const contentHash = d.contentHash ?? fallbackContentHash(d.sections)
    let sourceDocumentId = ''
    let genericDrugId = ''
    let masterId = d.drugId

    try {
      await db.transaction(async (tx) => {
        // 1) 来源文档层：按文件哈希（或内容哈希）幂等
        const sourceDocValues = {
          sourceType: 'manual-pdf' as const,
          sourceName: '说明书 PDF（本地资料库）',
          fileName: d.sourceFile,
          fileHash: d.sourceFileHash,
          contentHash,
          sourceRecordIds: d.sourceRecordIds,
          publishedAt: null,
          retrievedAt: d.pdfCreatedAt ? new Date(`${d.pdfCreatedAt}T00:00:00Z`) : new Date(d.extractedAt),
          metadata: {
            extractorVersion: d.extractorVersion,
            pageCount: d.pageCount,
            pdfCreatedAt: d.pdfCreatedAt,
          },
        }
        const existingSource = d.sourceFileHash
          ? (await tx.select({ id: sourceDocuments.id }).from(sourceDocuments).where(eq(sourceDocuments.fileHash, d.sourceFileHash)).limit(1))[0]
          : (await tx.select({ id: sourceDocuments.id }).from(sourceDocuments).where(eq(sourceDocuments.id, makeSourceDocumentId(d, contentHash))).limit(1))[0]
        if (existingSource) {
          sourceDocumentId = existingSource.id
          await tx.update(sourceDocuments)
            .set({ ...sourceDocValues, updatedAt: new Date() })
            .where(eq(sourceDocuments.id, existingSource.id))
        } else {
          sourceDocumentId = makeSourceDocumentId(d, contentHash)
          await tx.insert(sourceDocuments).values({ id: sourceDocumentId, ...sourceDocValues })
        }

        // 2) 通用名层：按通用名+剂型幂等
        const existingGeneric = (await tx.select({ id: drugGenerics.id }).from(drugGenerics)
          .where(and(eq(drugGenerics.genericName, d.genericName), eq(drugGenerics.form, d.form)))
          .limit(1))[0]
        if (existingGeneric) {
          genericDrugId = existingGeneric.id
        } else {
          genericDrugId = makeGenericId(d)
          await tx.insert(drugGenerics).values({
            id: genericDrugId,
            genericName: d.genericName,
            form: d.form,
            productType: d.productType,
          })
        }

        // 3) 产品层：先按 drugId，再按身份指纹复用
        if (masters.has(d.drugId)) {
          const existing = masters.get(d.drugId)!
          if (existing.identityKey && existing.identityKey !== identityKey) {
            throw new Error(
              `drugId ${d.drugId} 已存在但产品身份不一致（疑似同名多厂家/多规格撞 ID）；批量前必须先做命名消歧`,
            )
          }
          masterMsg = `exists(${existing.curationStatus})`
          masterId = d.drugId
        } else if (masterByIdentity.has(identityKey)) {
          masterId = masterByIdentity.get(identityKey)!
          masterMsg = `exists-by-identity(${masterId})`
        } else {
          await tx.insert(drugMaster).values({
            id: d.drugId,
            genericDrugId,
            genericName: d.genericName,
            brandName: d.brandName,
            specification: d.specification,
            form: d.form,
            manufacturer: d.manufacturer,
            repackager: d.repackager,
            approvalNumber: d.approvalNumbers.find((a) => !a.includes('分包装')) ?? d.approvalNumbers[0] ?? null,
            approvalNumbers: d.approvalNumbers,
            productType: d.productType,
            identityKey,
            otcClass: null,
            insuranceClass: null,
            isOriginal: false,
            curationStatus: 'crawled',
            dataSource: buildSource(d),
            note: d.curationNote,
          })
          masters.set(d.drugId, {
            id: d.drugId,
            genericName: d.genericName,
            brandName: d.brandName,
            form: d.form,
            specification: d.specification,
            curationStatus: 'crawled',
            identityKey,
          })
          masterByIdentity.set(identityKey, d.drugId)
          masterMsg = 'created'
          masterId = d.drugId
        }

        // 4) 说明书行：优先按（产品, 来源文档）幂等；兼容旧行（sourceDocumentId 为空）
        const values = mapDraftToInsertValues(d, sourceDocumentId, contentHash)
        const existing = insertRows.find((r) => r.drugId === masterId && r.sourceDocumentId === sourceDocumentId)
          ?? insertRows.find((r) => r.drugId === masterId && r.sourceDocumentId == null && r.version === d.version)
        const insertKey = `${masterId}|${sourceDocumentId}`
        const insertId = existing?.id ?? `pi-${masterId}@${d.version}-${sourceDocumentId.slice(3, 11)}`

        if (seenInsertKeys.has(insertKey) && !existing) {
          insertMsg = 'skipped-duplicate-source'
          reason = `同一来源文档已为 ${masterId} 导入过说明书`
        } else if (existing && existing.curationStatus !== 'crawled') {
          insertMsg = 'skipped'
          reason = `同（drugId, sourceDocumentId）已有 ${existing.curationStatus} 行（${existing.id}），write-once 不覆盖`
        } else if (existing) {
          const diff = mappedDiff(values, existing)
          if (diff.length === 0) {
            insertMsg = 'skipped-unchanged'
            reason = `同来源文档 / 版本 crawled 行已存在且内容一致（${existing.id}）`
          } else {
            await tx.update(packageInserts)
              .set({ ...values, curationStatus: 'crawled', updatedAt: new Date() })
              .where(eq(packageInserts.id, existing.id))
            insertMsg = `updated(${existing.id})`
            reason = `草稿内容变化，刷新：${diff.join(', ')}`
          }
          seenInsertKeys.add(insertKey)
        } else {
          await tx.insert(packageInserts).values({ id: insertId, drugId: masterId, curationStatus: 'crawled', ...values })
          insertMsg = `inserted(${insertId})`
          seenInsertKeys.add(insertKey)
        }

        if (dryRun) tx.rollback()
      })
    } catch (err) {
      if (dryRun && err instanceof TransactionRollbackError) {
        // 预期内的 dry-run 回滚信号
      } else {
        errors.push(`${d.drugId}: 数据库写入失败 — ${(err as Error).message}`)
        console.error(`  ${d.drugId.padEnd(40)} ❌ 写入失败：${(err as Error).message}`)
        continue
      }
    }

    if (!dryRun) {
      appendFileSync(importLogPath, `${JSON.stringify({
        runAt,
        drugId: masterId,
        draftDrugId: d.drugId,
        sourceFile: d.sourceFile,
        sourceDocumentId,
        contentHash,
        identityKey,
        sourceRecordIds: d.sourceRecordIds,
        version: d.version,
        packageInsert: { action: insertMsg, reason: reason ?? null },
        drugMaster: { action: masterMsg, id: masterId, genericDrugId },
      })}\n`)
    }
    results.push({ draft: d, insert: insertMsg, master: masterMsg, reason })
    console.log(`  ${d.drugId.padEnd(40)} insert=${insertMsg}  master=${masterMsg}${reason ? `  ← ${reason}` : ''}`)
  }

  const inserted = results.filter((r) => r.insert.startsWith('inserted')).length
  const updated = results.filter((r) => r.insert.startsWith('updated')).length
  const skipped = results.filter((r) => r.insert.startsWith('skipped')).length
  const masterCreated = results.filter((r) => r.master === 'created').length

  console.log(`\n${dryRun ? '🔍 dry-run 结果（未落库）' : '✅ 导入完成'}`)
  console.log(`   package_inserts：新增 ${inserted} / 刷新 ${updated} / 跳过 ${skipped}`)
  console.log(`   drug_master：自动建档 ${masterCreated} / 已有不动的 ${results.length - masterCreated}`)
  if (!dryRun) console.log(`   入库台账已追加：${importLogPath}`)
  if (errors.length) {
    console.error(`\n⚠️ ${errors.length} 份草稿失败：`)
    errors.forEach((e) => console.error(`   ${e}`))
  }
  return errors.length > 0 ? 1 : 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 导入失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
