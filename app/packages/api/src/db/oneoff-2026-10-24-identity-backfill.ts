/**
 * 一次性回填（2026-10-24）——给现有 8 条资产补通用名层/产品指纹/来源文档。
 *
 * 背景：0008 迁移新增 drug_generics / source_documents 与 drug_master.identity_key 等列；
 * 迁移只加列，不猜数据。本脚本按现有字段 + data/manuals 草稿做确定性回填，幂等。
 *
 * 用法：tsx src/db/oneoff-2026-10-24-identity-backfill.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { and, eq } from 'drizzle-orm'
import { db, client } from './client.js'
import { fallbackContentHash, inferProductType, makeGenericId, makeIdentityKey, makeSourceDocumentId, type ProductType } from './identity.js'
import { drugGenerics, drugMaster, packageInserts, sourceDocuments } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')
const manualsDir = join(repoRoot, 'data', 'manuals')
const crawledDir = join(repoRoot, 'data', 'crawled')

const KNOWN_TYPES: Record<string, ProductType> = {
  'drug-acetaminophen-650': '化学药',
  'drug-compound-pseudoephedrine': '化学药',
  'drug-ganmaoling-999': '中成药',
  'drug-ibuprofen-300': '化学药',
  'drug-lianhua-qingwen': '中成药',
  'drug-nifedipine-30': '化学药',
}

function loadDrafts(): Map<string, any> {
  const out = new Map<string, any>()
  for (const file of readdirSync(manualsDir).filter((f) => f.endsWith('.json'))) {
    try {
      const d = JSON.parse(readFileSync(join(manualsDir, file), 'utf8'))
      if (d?.drugId) out.set(d.drugId, d)
    } catch {
      // 单份草稿解析失败不阻塞其余回填；导入脚本会单独报
    }
  }
  return out
}

function loadCrawledDrafts(): Map<string, any> {
  const out = new Map<string, any>()
  try {
    for (const file of readdirSync(crawledDir).filter((f) => f.endsWith('.json'))) {
      try {
        const d = JSON.parse(readFileSync(join(crawledDir, file), 'utf8'))
        if (d?.drugId) out.set(d.drugId, d)
      } catch {
        // 忽略单份损坏草稿
      }
    }
  } catch {
    // 本地没有 crawled 目录时跳过 DXY 段落回填
  }
  return out
}

async function main(): Promise<number> {
  const drafts = loadDrafts()
  const crawledDrafts = loadCrawledDrafts()
  const masters = await db.select().from(drugMaster)
  const inserts = await db.select().from(packageInserts)
  const counts = { mastersUpdated: 0, genericsCreated: 0, sourceDocsCreated: 0, insertsLinked: 0, sectionsBackfilled: 0 }

  await db.transaction(async (tx) => {
    for (const m of masters) {
      const draft = drafts.get(m.id)
      const approvals = m.approvalNumbers ?? draft?.approvalNumbers ?? (m.approvalNumber ? [m.approvalNumber] : [])
      const repackager = m.repackager ?? draft?.repackager ?? null
      const productType = m.productType ?? draft?.productType ?? KNOWN_TYPES[m.id] ?? inferProductType(m.genericName, m.form, approvals)
      const identityKey = makeIdentityKey({
        genericName: m.genericName,
        specification: m.specification,
        form: m.form,
        manufacturer: m.manufacturer,
        repackager,
        approvalNumbers: approvals,
      })

      const existingGeneric = (await tx.select({ id: drugGenerics.id }).from(drugGenerics)
        .where(and(eq(drugGenerics.genericName, m.genericName), eq(drugGenerics.form, m.form)))
        .limit(1))[0]
      let genericDrugId = existingGeneric?.id ?? m.genericDrugId
      if (!genericDrugId) {
        genericDrugId = makeGenericId({ genericName: m.genericName, form: m.form })
        await tx.insert(drugGenerics).values({
          id: genericDrugId,
          genericName: m.genericName,
          form: m.form,
          productType,
        })
        counts.genericsCreated += 1
      }

      const changed =
        m.identityKey !== identityKey ||
        m.genericDrugId !== genericDrugId ||
        m.productType !== productType ||
        JSON.stringify(m.approvalNumbers ?? null) !== JSON.stringify(approvals) ||
        m.repackager !== repackager
      if (changed) {
        await tx.update(drugMaster)
          .set({ identityKey, genericDrugId, productType, approvalNumbers: approvals, repackager, updatedAt: new Date() })
          .where(eq(drugMaster.id, m.id))
        counts.mastersUpdated += 1
      }
    }

    for (const pi of inserts) {
      if (pi.sourceDocumentId) continue
      const draft = drafts.get(pi.drugId)
      if (draft) {
        const contentHash = draft.contentHash ?? fallbackContentHash(draft.sections)
        const sourceDocumentId = makeSourceDocumentId(draft, contentHash)
        const existing = (await tx.select({ id: sourceDocuments.id }).from(sourceDocuments)
          .where(eq(sourceDocuments.id, sourceDocumentId)).limit(1))[0]
        if (!existing) {
          await tx.insert(sourceDocuments).values({
            id: sourceDocumentId,
            sourceType: 'manual-pdf',
            sourceName: '说明书 PDF（本地资料库）',
            fileName: draft.sourceFile,
            fileHash: draft.sourceFileHash ?? null,
            contentHash,
            sourceRecordIds: draft.sourceRecordIds ?? [],
            publishedAt: null,
            retrievedAt: draft.pdfCreatedAt ? new Date(`${draft.pdfCreatedAt}T00:00:00Z`) : new Date(draft.extractedAt),
            metadata: {
              extractorVersion: draft.extractorVersion ?? null,
              pageCount: draft.pageCount ?? null,
              pdfCreatedAt: draft.pdfCreatedAt ?? null,
            },
          })
          counts.sourceDocsCreated += 1
        }
        await tx.update(packageInserts)
          .set({ sourceDocumentId, contentHash, updatedAt: new Date() })
          .where(eq(packageInserts.id, pi.id))
        counts.insertsLinked += 1
        continue
      }

      const crawled = crawledDrafts.get(pi.drugId)
      if (!pi.sourceSections && crawled?.sections && Object.keys(crawled.sections).length > 0) {
        const sections = crawled.sections as Record<string, string>
        await tx.update(packageInserts)
          .set({
            sourceSections: sections,
            contentHash: fallbackContentHash(sections),
            sourceRecordIds: crawled.dxyId ? [crawled.dxyId] : pi.sourceRecordIds,
            updatedAt: new Date(),
          })
          .where(eq(packageInserts.id, pi.id))
        counts.sectionsBackfilled += 1
      }
    }
  })

  console.log('✅ 身份回填完成')
  console.log(`   drug_master 更新 ${counts.mastersUpdated} 行`)
  console.log(`   drug_generics 新建 ${counts.genericsCreated} 行`)
  console.log(`   source_documents 新建 ${counts.sourceDocsCreated} 行`)
  console.log(`   package_inserts 关联来源 ${counts.insertsLinked} 行`)
  console.log(`   DXY 段落回填 ${counts.sectionsBackfilled} 行`)
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 身份回填失败（事务已回滚）:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
