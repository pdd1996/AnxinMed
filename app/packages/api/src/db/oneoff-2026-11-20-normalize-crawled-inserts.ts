/**
 * 一次性数据整理（2026-11-20）——crawled 说明书的长文本排版数据化。
 *
 * 背景：用户要求「优化排版、简化文字」后，发现大量 crawled 说明书行的
 * 注意事项/禁忌被抽成「单元素整段」（可达 1000+ 字），且 PDF 硬折行留下词内空格/换行
 * （如「乙型流 感」）。前端已做展示层拆分/折叠，本脚本把**数据层**也理顺，
 * 让所有消费方（咨询卡、分段落页、审核工具）拿到逐条数组与无折行噪声的文本。
 *
 * 安全设计（对齐 docs/specs/26 与既有 one-off 纪律）：
 * - 默认 dry-run，只读、只打印；`--apply` 才写库，且必须提供 48h 内的 pg_dump；
 * - 只处理 curationStatus='crawled' 的行；reviewed/mock 一律不碰（人工核验过的内容保持原样）；
 * - 不改 curationStatus（未核验仍是未核验，不能借清洗升格）；
 * - 全流程单事务，逐行字符完整性校验（忽略空白后必须逐字相等），任何一行不通过 → 回滚；
 * - 事务内跑幂等校验：再跑一遍 transformation 必须 0 变更；
 * - 只拆「注意事项 / 禁忌」两个 jsonb 段 + 归一 typed 长文本字段的折行；sourceSections 不动
 *   （分段落页展示时实时归一，避免改动原文分段键）。
 *
 * 用法（在 app/packages/api 下）：
 *   pnpm db:normalize-crawled-inserts                                    # dry-run
 *   pg_dump "$DATABASE_URL" -Fc -f ../../backups/anxin-pre-normalize-20261120.dump
 *   pnpm db:normalize-crawled-inserts -- --apply --backup ../../backups/anxin-pre-normalize-20261120.dump
 *
 * 回滚：pg_restore -d "$DATABASE_URL" --clean --if-exists <dump>
 */
import '../lib/env.js'
import { existsSync, statSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, client, type Executor } from './client.js'
import { packageInserts } from './schema.js'
import { normalizeLeafletText } from '../services/consult/sections.js'

const BACKUP_MAX_AGE_MS = 48 * 60 * 60 * 1000
const NOTE_SUFFIX = '2026-11-20 排版数据整理：注意事项/禁忌单元素整段按编号拆条 + PDF 折行空格归一（未改 curation_status）'

interface RowText {
  id: string
  genericName: string | null
  curationNote: string | null
  precautions: unknown
  contraindications: unknown
  indication: string | null
  adverseReactions: string | null
  interactions: string | null
  pharmacology: string | null
  pharmacokinetics: string | null
  storage: string | null
  components: string | null
}

/** 按行首编号拆条（保留原编号，不丢字符）；拆不出来返回 [整段归一后文本]。 */
export function splitPreservingMarkers(raw: string): string[] {
  const parts = raw.split(/\n(?=\s*(?:[·●•○]\s*)?\d{1,2}\s*[.、．)）])/)
  return parts.map((p) => normalizeLeafletText(p)).filter(Boolean)
}

function joinUnknown(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '')).join('\n')
  return typeof value === 'string' ? value : ''
}

/** 字符完整性：忽略所有空白后逐字相等（折行/空格归一不算改内容）。 */
function sameChars(a: string, b: string): boolean {
  return a.replace(/\s+/g, '') === b.replace(/\s+/g, '')
}

/** jsonb 段落 → 归一后的形态（数组逐条 / 字符串单条；编号保留）。 */
export function normalizeSectionValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value
      .map((v) => String(v ?? ''))
      .filter(Boolean)
      .flatMap((item) => (item.includes('\n') ? splitPreservingMarkers(item) : [normalizeLeafletText(item)]))
      .filter(Boolean)
    return items
  }
  if (typeof value === 'string') {
    const parts = splitPreservingMarkers(value)
    if (parts.length > 1) return parts
    return normalizeLeafletText(value)
  }
  return value
}

function normalizeTextField(text: string | null): string | null {
  if (!text) return text
  const next = normalizeLeafletText(text)
  return sameChars(text, next) ? next : text
}

function buildPatch(row: RowText): {
  patch: Partial<typeof packageInserts.$inferInsert>
  notes: string[]
} {
  const patch: Partial<typeof packageInserts.$inferInsert> = {}
  const notes: string[] = []

  const precautions = normalizeSectionValue(row.precautions)
  if (JSON.stringify(precautions) !== JSON.stringify(row.precautions)) {
    if (!sameChars(joinUnknown(row.precautions), joinUnknown(precautions))) {
      throw new Error(`字符完整性校验失败（precautions）：${row.id}`)
    }
    patch.precautions = precautions
    notes.push(`注意事项 ${Array.isArray(precautions) ? `${precautions.length} 条` : '单条'}`)
  }

  const contraindications = normalizeSectionValue(row.contraindications)
  if (JSON.stringify(contraindications) !== JSON.stringify(row.contraindications)) {
    if (!sameChars(joinUnknown(row.contraindications), joinUnknown(contraindications))) {
      throw new Error(`字符完整性校验失败（contraindications）：${row.id}`)
    }
    patch.contraindications = contraindications
    notes.push(`禁忌 ${Array.isArray(contraindications) ? `${contraindications.length} 条` : '单条'}`)
  }

  const typedFields = [
    'indication',
    'adverseReactions',
    'interactions',
    'pharmacology',
    'pharmacokinetics',
    'storage',
    'components',
  ] as const
  let typedChanged = false
  for (const field of typedFields) {
    const before = row[field]
    const after = normalizeTextField(before)
    if (after !== before) {
      if (!sameChars(before ?? '', after ?? '')) throw new Error(`字符完整性校验失败（${field}）：${row.id}`)
      patch[field] = after
      typedChanged = true
    }
  }
  if (typedChanged) notes.push('typed 长文本折行归一')

  if (notes.length > 0) {
    patch.curationNote = row.curationNote ? `${row.curationNote}；${NOTE_SUFFIX}` : NOTE_SUFFIX
    patch.updatedAt = new Date()
  }
  return { patch, notes }
}

async function loadCrawled(exec: Executor): Promise<RowText[]> {
  return exec
    .select({
      id: packageInserts.id,
      genericName: packageInserts.genericName,
      curationNote: packageInserts.curationNote,
      precautions: packageInserts.precautions,
      contraindications: packageInserts.contraindications,
      indication: packageInserts.indication,
      adverseReactions: packageInserts.adverseReactions,
      interactions: packageInserts.interactions,
      pharmacology: packageInserts.pharmacology,
      pharmacokinetics: packageInserts.pharmacokinetics,
      storage: packageInserts.storage,
      components: packageInserts.components,
    })
    .from(packageInserts)
    .where(eq(packageInserts.curationStatus, 'crawled'))
}

function summarize(rows: RowText[]): { changed: Array<{ row: RowText; notes: string[] }>; errors: string[] } {
  const changed: Array<{ row: RowText; notes: string[] }> = []
  const errors: string[] = []
  for (const row of rows) {
    try {
      const { patch, notes } = buildPatch(row)
      if (Object.keys(patch).length > 0) changed.push({ row, notes })
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  return { changed, errors }
}

function printReport(rows: RowText[], changed: Array<{ row: RowText; notes: string[] }>, errors: string[]): void {
  const splitPrec = changed.filter((c) => c.notes.some((n) => n.startsWith('注意事项'))).length
  const splitContra = changed.filter((c) => c.notes.some((n) => n.startsWith('禁忌'))).length
  const typedOnly = changed.filter((c) => c.notes.length === 1 && c.notes[0].includes('typed')).length
  console.log(`crawled 行：${rows.length}`)
  console.log(`待整理行：${changed.length}（注意事项拆条 ${splitPrec} / 禁忌拆条 ${splitContra} / 仅 typed 折行 ${typedOnly}）`)
  if (errors.length > 0) {
    console.error(`❌ 完整性/结构校验失败 ${errors.length} 行（不写库）：`)
    for (const err of errors.slice(0, 10)) console.error(`  - ${err}`)
    return
  }
  for (const { row, notes } of changed.slice(0, 8)) {
    console.log(`  · ${row.id}`)
    console.log(`    ${row.genericName ?? '（未命名）'} → ${notes.join('；')}`)
  }
  if (changed.length > 8) console.log(`  … 其余 ${changed.length - 8} 行同理`)
}

function checkBackup(path: string | null): string {
  if (!path) throw new Error('--apply 必须提供 --backup <pg_dump 文件>（48h 内）')
  if (!existsSync(path)) throw new Error(`备份文件不存在：${path}`)
  const age = Date.now() - statSync(path).mtimeMs
  if (age > BACKUP_MAX_AGE_MS) throw new Error(`备份文件超过 48 小时：${path}`)
  return path
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const backupIdx = args.indexOf('--backup')
  const backup = backupIdx >= 0 ? (args[backupIdx + 1] ?? null) : null

  const rows = await loadCrawled(db)
  const { changed, errors } = summarize(rows)
  printReport(rows, changed, errors)

  if (!apply) {
    console.log('\nDRY-RUN：未写库。加 --apply --backup <pg_dump 文件> 执行。')
    return errors.length > 0 ? 1 : 0
  }
  if (errors.length > 0) return 1
  const backupPath = checkBackup(backup)
  console.log(`\n备份：${backupPath}（${(statSync(backupPath).size / 1024 / 1024).toFixed(1)} MB）`)

  await db.transaction(async (tx) => {
    for (const { row } of changed) {
      const { patch } = buildPatch(row)
      await tx.update(packageInserts).set(patch).where(eq(packageInserts.id, row.id))
    }
    // 幂等校验：同一事务内再跑一遍必须 0 变更（否则说明 transformation 不稳定）
    const afterRows = await loadCrawled(tx)
    const after = summarize(afterRows)
    if (after.errors.length > 0) throw new Error(`迁移后完整性校验失败：${after.errors[0]}`)
    if (after.changed.length > 0) throw new Error(`迁移后仍有 ${after.changed.length} 行可变更（非幂等，回滚）`)
  })

  console.log(`\n✅ 已提交：${changed.length} 行整理完成（事务内幂等校验通过）`)
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
