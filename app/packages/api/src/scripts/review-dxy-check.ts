/**
 * M8-T3 · DXY 15 行自动核对 → review decisions + 报告。
 *
 * 输入：`db:review-export --source dxy` 导出的批次 JSON（含 sourceSections / mapped / identity）。
 * 输出：
 *   - decisions JSON（可直接交给 db:review-apply；只把全部检查通过的行走 promote，其余 skip）；
 *   - 报告 JSON + Markdown（逐行结论、错误项、六必核段状态），供人工抽检。
 *
 * 边界：这是**结构一致性核对**，不是医学判断。reviewed 的最终责任仍以 `--reviewer`
 * 记录的实际执行者/口径为准；报告里明确写出「auto: true」与抽检要求。
 *
 * 用法（cd app/packages/api）：
 *   npm run db:review-dxy-check -- --in ../../../data/m8-reports/dxy-15.json \
 *     --out ../../../data/m8-reports/dxy-decisions.json --reviewer "M8-自动核验"
 */
import '../lib/env.js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fallbackContentHash } from '../db/identity.js'
import { REQUIRED_SECTIONS, type RequiredSectionKey } from '../services/review/decisions.js'

interface ExportItem {
  insertId: string
  drugId: string
  version: string | null
  sourceKind?: string
  sourceFile: string | null
  sourceUrl: string | null
  contentHash: string | null
  identity: {
    genericName: string
    brandName: string | null
    form: string | null
    specification: string | null
    manufacturer: string | null
    approvalNumbers: string[]
    productType: string | null
  }
  mapped: {
    indication: string
    contraindication: string
    precautions: string
    adverse: string
    interactions: string
    dosage: string
  }
  sourceSections: Record<string, string>
}

interface ExportBatch {
  schemaVersion: number
  batchId: string
  generatedAt: string
  status: string
  sourceKind?: string
  items: ExportItem[]
}

interface SectionDecision {
  status: 'verified' | 'source-missing' | 'corrected'
  text?: string
  reason?: string
}

interface DecisionItem {
  insertId: string
  drugId: string
  contentHash: string | null
  action: 'promote' | 'reject' | 'skip'
  identityConfirmed: boolean
  optionalConfirmed: boolean
  rejectReason: string
  sections: Record<string, SectionDecision>
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

function norm(input: string | null | undefined): string {
  return String(input ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[。；;，,]+$/g, '')
}

function mappedText(item: ExportItem, key: RequiredSectionKey): string {
  switch (key) {
    case 'indication':
      return item.mapped.indication ?? ''
    case 'contraindication':
      return item.mapped.contraindication ?? ''
    case 'precautions':
      return item.mapped.precautions ?? ''
    case 'adverse':
      return item.mapped.adverse ?? ''
    case 'interactions':
      return item.mapped.interactions ?? ''
    case 'dosage':
      return item.mapped.dosage ?? ''
  }
}

function sourceText(item: ExportItem, key: RequiredSectionKey): { text: string; sourceKey: string | null } {
  const slot = REQUIRED_SECTIONS.find((s) => s.key === key)!
  for (const sourceKey of slot.sourceKeys) {
    const text = item.sourceSections?.[sourceKey] ?? ''
    if (text.trim()) return { text, sourceKey }
  }
  return { text: '', sourceKey: null }
}

interface CheckResult {
  item: ExportItem
  errors: string[]
  warnings: string[]
  sections: Record<string, SectionDecision>
  action: 'promote' | 'skip'
}

function checkItem(item: ExportItem): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  const sections: Record<string, SectionDecision> = {}

  // 1. 来源与指纹
  if (item.sourceKind !== 'dxy') errors.push(`sourceKind=${item.sourceKind ?? '(空)'}，不是 dxy 批次`)
  if (!item.version) errors.push('version 为空')
  if (!item.sourceUrl) errors.push('sourceUrl 为空（DXY 行必须能回溯来源页）')
  if (!item.contentHash) errors.push('contentHash 为空（先跑 db:backfill-dxy-sections）')
  if (Object.keys(item.sourceSections ?? {}).length === 0) errors.push('sourceSections 为空（先跑 db:backfill-dxy-sections）')
  if (item.contentHash && Object.keys(item.sourceSections ?? {}).length > 0) {
    const expected = fallbackContentHash(item.sourceSections)
    if (expected !== item.contentHash) errors.push(`contentHash 与 sourceSections 不一致（库 ${item.contentHash.slice(0, 12)}… / 复算 ${expected.slice(0, 12)}…）`)
  }

  // 2. 身份：规格列必须与原文【规格】段一致（归一化空白/全半角/尾部标点）
  const rawSpec = item.sourceSections?.['规格'] ?? ''
  if (!rawSpec.trim()) {
    warnings.push('原文无【规格】段，无法核对规格列')
  } else if (norm(item.identity.specification) !== norm(rawSpec)) {
    errors.push(`规格列与原文不一致（库「${item.identity.specification ?? ''}」/ 原文「${rawSpec}」）`)
  }

  // 3. 六必核段：映射列 ↔ 原文段逐段核对
  for (const slot of REQUIRED_SECTIONS) {
    const source = sourceText(item, slot.key)
    const mapped = mappedText(item, slot.key)
    if (source.text.trim()) {
      if (!mapped.trim()) {
        errors.push(`「${slot.label}」原文有段但映射列为空`)
        sections[slot.key] = { status: 'source-missing' } // 占位，最终因 errors 不会 promote
      } else if (norm(source.text) !== norm(mapped)) {
        errors.push(`「${slot.label}」映射列与原文段不一致（需人工修正，不能自动 promote）`)
        sections[slot.key] = { status: 'corrected', text: source.text, reason: 'M8 自动核验：映射列与原文不一致，待人工确认' }
      } else {
        sections[slot.key] = { status: 'verified' }
      }
    } else if (mapped.trim()) {
      errors.push(`「${slot.label}」映射列有内容但原文段缺失（来源不可追溯）`)
      sections[slot.key] = { status: 'verified' }
    } else {
      sections[slot.key] = { status: 'source-missing' }
    }
  }

  return { item, errors, warnings, sections, action: errors.length === 0 ? 'promote' : 'skip' }
}

function main(): number {
  const inPath = arg('--in')
  const outPath = arg('--out')
  const reviewer = arg('--reviewer')
  if (!inPath || !outPath) {
    console.error('❌ 缺少 --in / --out')
    return 1
  }
  if (!reviewer?.trim()) {
    console.error('❌ 缺少 --reviewer（记录实际核对人/口径，不允许空）')
    return 1
  }

  const batch = JSON.parse(readFileSync(resolve(inPath), 'utf8')) as ExportBatch
  if (batch.status !== 'crawled' || batch.sourceKind !== 'dxy') {
    console.error(`❌ 批次不是 crawled/dxy（status=${batch.status} sourceKind=${batch.sourceKind ?? '空'}）`)
    return 1
  }
  if (batch.items.length === 0) {
    console.error('❌ 批次为空')
    return 1
  }

  const results = batch.items.map(checkItem)
  const decisions: {
    schemaVersion: 1
    batchId: string
    reviewer: string
    exportedAt: string
    items: DecisionItem[]
  } = {
    schemaVersion: 1,
    batchId: batch.batchId,
    reviewer: reviewer.trim(),
    exportedAt: new Date().toISOString(),
    items: results.map((r) => ({
      insertId: r.item.insertId,
      drugId: r.item.drugId,
      contentHash: r.item.contentHash,
      action: r.action,
      identityConfirmed: r.action === 'promote',
      optionalConfirmed: r.action === 'promote',
      rejectReason: r.errors.join('；'),
      sections: r.sections,
    })),
  }

  const promote = results.filter((r) => r.action === 'promote')
  const skip = results.filter((r) => r.action === 'skip')
  const report = {
    generatedAt: new Date().toISOString(),
    batchId: batch.batchId,
    reviewer: reviewer.trim(),
    auto: true,
    total: results.length,
    promote: promote.length,
    skip: skip.length,
    note: '结构一致性核对，不是医学判断；reviewed_by 记录实际执行口径，人工抽检 ≥5 行后才可视为完成。',
    items: results.map((r) => ({
      drugId: r.item.drugId,
      insertId: r.item.insertId,
      action: r.action,
      errors: r.errors,
      warnings: r.warnings,
      sections: r.sections,
    })),
  }

  const absoluteOut = resolve(outPath)
  mkdirSync(dirname(absoluteOut), { recursive: true })
  writeFileSync(absoluteOut, `${JSON.stringify(decisions, null, 2)}\n`, 'utf8')
  const reportPath = absoluteOut.replace(/\.json$/i, '-report.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const lines: string[] = []
  lines.push('# M8-T3 · DXY 15 行自动核对报告')
  lines.push('')
  lines.push(`批次：${batch.batchId} · 核对人/口径：${reviewer.trim()} · 生成：${report.generatedAt}`)
  lines.push('')
  lines.push('> 结构一致性核对，不是医学判断；`reviewed_by` 以实际执行口径记录，升 reviewed 前需人工抽检 ≥5 行。')
  lines.push('')
  lines.push(`**通过 ${promote.length} / 跳过 ${skip.length} / 共 ${results.length}**`)
  lines.push('')
  lines.push('| 药品 | insertId | 结论 | 六必核段 | 错误 |')
  lines.push('|---|---|---|---|---|')
  for (const r of results) {
    const sec = REQUIRED_SECTIONS.map((s) => `${s.label}:${r.sections[s.key]?.status ?? '-'}`).join('<br>')
    lines.push(
      `| ${r.item.drugId} | \`${r.item.insertId}\` | ${r.action === 'promote' ? '✅ promote' : '⏭ skip'} | ${sec} | ${r.errors.join('<br>') || '—'} |`,
    )
  }
  lines.push('')
  lines.push('## 人工抽检要求')
  lines.push('')
  lines.push('- 从 promote 行中抽 ≥5 行，对照 DXY 来源页/草稿原文核对身份与六段；')
  lines.push('- suspect 行改 `action=skip` 后重新生成 decisions；')
  lines.push('- 抽检记录落 `data/m8-reports/dxy-spotcheck.md`（本地），再执行 `db:review-apply`。')
  writeFileSync(absoluteOut.replace(/\.json$/i, '-report.md'), lines.join('\n') + '\n', 'utf8')

  console.log(`✅ 自动核对完成：promote ${promote.length} / skip ${skip.length}`)
  for (const r of results) {
    const status = r.action === 'promote' ? '✅' : '⏭ '
    console.log(`  ${status} ${r.item.drugId.padEnd(34)} ${r.errors.length ? r.errors.join('；') : '六段一致'}`)
  }
  console.log(`\n   decisions：${absoluteOut}`)
  console.log(`   报告：${absoluteOut.replace(/\.json$/i, '-report.md')}`)
  return skip.length === 0 ? 0 : 2
}

const code = main()
process.exit(code)
