/**
 * M11-T2 · 药师复核 CSV → seed 变更草案（dry-run，不改 seed/DB）。
 *
 * 输入：data/m11-reports/药师复核单-35条.csv（药师填写「判定 / 改为级别 / 备注」）
 * 输出：data/m11-reports/pharmacist-review-report.md
 *       data/m11-reports/seed-updates-pharmacist.json
 *
 * 判定写法：
 *   同意
 *   改为：禁忌 | 慎用 | 需监测 | 注意（也可把级别写「改为级别」列）
 *   不收  → 建议 status='retired'（不删除历史）
 *
 * 只生成变更草案；确认后再按现有 `db:seed-interaction-rules` 流程 apply。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')
const LEVELS = ['禁忌', '慎用', '需监测', '注意'] as const
type Level = (typeof LEVELS)[number]

interface SeedRule {
  id: string
  level: string
  status: string
  note: string
  drugGroups?: string[][]
}
interface Row {
  id: string
  pair: string
  currentLevel: string
  decision: string
  targetLevel: string
  note: string
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function normalizeLevel(raw: string): Level | null {
  const s = raw.trim().replace(/^改为\s*[:：]\s*/, '')
  return LEVELS.includes(s as Level) ? (s as Level) : null
}

async function main(): Promise<number> {
  const csvPath = join(repoRoot, process.argv.includes('--csv') ? process.argv[process.argv.indexOf('--csv') + 1] : join('data', 'm11-reports', '药师复核单-35条.csv'))
  const outDir = join(repoRoot, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join('data', 'm11-reports'))
  mkdirSync(outDir, { recursive: true })

  const seed = JSON.parse(readFileSync(join(__dirname, '..', 'db', 'seed-interaction-rules.json'), 'utf8')) as SeedRule[]
  const curated = seed.filter((r) => r.status === 'curated')
  const byId = new Map(curated.map((r) => [r.id, r]))

  const raw = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '')
  const table = parseCsv(raw)
  const header = table[0].map((h) => h.trim())
  const col = (name: string) => header.indexOf(name)
  const idx = { id: col('规则ID'), pair: col('药对'), level: col('当前级别'), decision: col('判定'), target: col('改为级别'), note: col('备注') }
  if (Object.values(idx).some((i) => i < 0)) {
    console.error('❌ CSV 缺少必需列（规则ID/药对/当前级别/判定/改为级别/备注）')
    return 1
  }

  const rows: Row[] = table
    .slice(1)
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => ({
      id: (r[idx.id] ?? '').trim(),
      pair: (r[idx.pair] ?? '').trim(),
      currentLevel: (r[idx.level] ?? '').trim(),
      decision: (r[idx.decision] ?? '').trim(),
      targetLevel: (r[idx.target] ?? '').trim(),
      note: (r[idx.note] ?? '').trim(),
    }))

  const seen = new Set<string>()
  const changes: Array<{ id: string; pair: string; fromLevel: string; toLevel: string; action: 'keep' | 'change' | 'retire'; note: string }> = []
  const errors: string[] = []
  let pending = 0

  for (const r of rows) {
    if (!byId.has(r.id)) {
      errors.push(`未知规则 ID：${r.id}`)
      continue
    }
    if (seen.has(r.id)) {
      errors.push(`重复规则 ID：${r.id}`)
      continue
    }
    seen.add(r.id)
    const base = { id: r.id, pair: r.pair, fromLevel: r.currentLevel, note: r.note }
    if (!r.decision) {
      pending++
      continue
    }
    if (r.decision === '同意') {
      changes.push({ ...base, toLevel: r.currentLevel, action: 'keep' })
      continue
    }
    if (r.decision === '不收') {
      changes.push({ ...base, toLevel: r.currentLevel, action: 'retire' })
      continue
    }
    const target = normalizeLevel(r.decision) ?? normalizeLevel(r.targetLevel)
    if (r.decision.startsWith('改为') && !target) {
      errors.push(`无法识别的改判级别：${r.id}「${r.decision} / ${r.targetLevel}」`)
      continue
    }
    if (!target) {
      errors.push(`无法识别的判定：${r.id}「${r.decision}」`)
      continue
    }
    changes.push({ ...base, toLevel: target, action: 'change' })
  }

  const missing = curated.filter((r) => !seen.has(r.id)).map((r) => r.id)
  const counts = changes.reduce(
    (acc, c) => {
      acc[c.action] += 1
      return acc
    },
    { keep: 0, change: 0, retire: 0 },
  )
  const updatable = errors.length === 0 && pending === 0

  const md: string[] = []
  md.push('# 药师复核结果 · seed 变更草案')
  md.push('')
  md.push(`来源：${csvPath}`)
  md.push('')
  md.push(`- 已判定：${changes.length} 条（同意 ${counts.keep} / 改判 ${counts.change} / 不收 ${counts.retire}）`)
  md.push(`- 未填判定：${pending} 条`)
  md.push(`- 缺失行：${missing.length} 条${missing.length > 0 ? '（' + missing.join('、') + '）' : ''}`)
  md.push(`- 校验错误：${errors.length} 条`)
  md.push(`- **可生成 seed 变更：${updatable ? '是' : '否'}**`)
  md.push('')
  if (errors.length > 0) {
    md.push('## ❌ 校验错误')
    md.push('')
    errors.forEach((e) => md.push(`- ${e}`))
    md.push('')
  }
  md.push('## 变更清单')
  md.push('')
  md.push('| 规则 ID | 药对 | 原级别 | 判定 | 目标 | 备注 |')
  md.push('|---|---|---|---|---|---|')
  for (const c of changes) {
    const action = c.action === 'keep' ? '同意' : c.action === 'change' ? '改判' : '不收'
    md.push(`| ${c.id} | ${c.pair.replace(/\|/g, '｜')} | ${c.fromLevel} | ${action} | ${c.action === 'retire' ? 'retired' : c.toLevel} | ${c.note.replace(/\|/g, '｜')} |`)
  }
  md.push('')
  md.push('> dry-run：未修改 seed、未写库。确认后：把变更合入 seed → `db:seed-interaction-rules --check` → apply。')
  writeFileSync(join(outDir, 'pharmacist-review-report.md'), md.join('\n') + '\n')

  const updates = {
    generatedAt: new Date().toISOString(),
    source: csvPath,
    updatable,
    counts,
    pending,
    missing,
    errors,
    changes: changes.filter((c) => c.action !== 'keep'),
  }
  writeFileSync(join(outDir, 'seed-updates-pharmacist.json'), JSON.stringify(updates, null, 2) + '\n')

  console.log(`\n${updatable ? '✅' : '⚠️'} 药师复核：同意 ${counts.keep} / 改判 ${counts.change} / 不收 ${counts.retire} / 未填 ${pending} / 错误 ${errors.length} / 缺失 ${missing.length}`)
  console.log(`   输出：${join(outDir, 'pharmacist-review-report.md')} / seed-updates-pharmacist.json`)
  return updatable ? 0 : 1
}

main().catch((err) => {
  console.error('❌ 药师复核导入失败:', err)
  process.exit(1)
})
