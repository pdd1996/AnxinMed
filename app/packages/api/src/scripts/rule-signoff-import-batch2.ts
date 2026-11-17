/**
 * M11-T3 · 第二批（预审修正版）签核结果 → seed 草案（dry-run，不写库）。
 *
 * 输入：data/review-manual/signoff-batch2-final-decisions.json
 *       data/m11-reports/signoff-batch2.final.json（quote/范围/级别已按工程预审修正）
 * 输出：data/m11-reports/seed-additions-batch2.json / import-report-batch2.md
 *
 * 与第一批 importer 的差异：本批没有“按索引改药品组”的硬编码覆盖——最终 JSON 里
 * 已是修正后的 quote/drugGroups，直接走守门即可。
 */
import 'dotenv/config'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inArray } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import { drugMaster, interactionRules, packageInserts } from '../db/schema.js'
import {
  normalizeQuoteText,
  validateRules,
  type ManualSnapshot,
  type RuleCurationContext,
  type RuleCurationInput,
} from '../services/rules/rule-curation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}
function resolvePath(p: string): string {
  return isAbsolute(p) ? p : join(repoRoot, p)
}

interface Decision {
  index: number
  decision: 'pass' | 'edit' | 'reject'
  level: string
  note: string
  reason: string
}

interface FinalItem {
  index: number
  level: string
  quote: string
  source: { insertId: string; drugId: string; genericName: string; version: string | null; sectionKey: string }
  groups: string[][]
  drugIds: string[]
  proposedRule: {
    id: string
    drugIds: string[]
    drugGroups: string[][]
    level: string
    note: string
    quote: string
    source: string
    sourceType: string
    sourceRef: string
  }
}

async function main(): Promise<number> {
  const decisionsPath = resolvePath(arg('--decisions') ?? join('data', 'review-manual', 'signoff-batch2-final-decisions.json'))
  const signoffPath = resolvePath(arg('--signoff') ?? join('data', 'm11-reports', 'signoff-batch2.final.json'))
  const outDir = resolvePath(arg('--out') ?? join('data', 'm11-reports'))
  mkdirSync(outDir, { recursive: true })

  const decisions = JSON.parse(readFileSync(decisionsPath, 'utf8')) as { reviewer: string; exportedAt: string; decisions: Decision[] }
  const signoff = JSON.parse(readFileSync(signoffPath, 'utf8')) as { items: FinalItem[] }
  const dmap = new Map(decisions.decisions.map((d) => [d.index, d]))

  const masterRows = await db.select({ id: drugMaster.id, genericName: drugMaster.genericName, form: drugMaster.form }).from(drugMaster)
  const masterById = new Map(masterRows.map((m) => [m.id, m.genericName]))
  const formById = new Map(masterRows.map((m) => [m.id, m.form ?? '']))

  const insertIds = [...new Set(signoff.items.map((it) => it.source.insertId))]
  const inserts = await db
    .select({
      id: packageInserts.id,
      drugId: packageInserts.drugId,
      curationStatus: packageInserts.curationStatus,
      sourceSections: packageInserts.sourceSections,
    })
    .from(packageInserts)
    .where(inArray(packageInserts.id, insertIds))
  const manualsByInsertId: Record<string, ManualSnapshot> = {}
  for (const r of inserts) {
    manualsByInsertId[r.id] = { insertId: r.id, drugId: r.drugId, curationStatus: r.curationStatus, sections: r.sourceSections ?? {} }
  }

  const existingRows = await db
    .select({ id: interactionRules.id, drugIds: interactionRules.drugIds, drugGroups: interactionRules.drugGroups, status: interactionRules.status })
    .from(interactionRules)
  const ctx: RuleCurationContext = {
    existingDrugMasterIds: masterRows.map((m) => m.id),
    manualsByInsertId,
    existingRules: existingRows.map((r) => ({
      id: r.id,
      drugIds: (r.drugIds as string[] | null) ?? [],
      drugGroups: (r.drugGroups as string[][] | null) ?? null,
      status: r.status,
    })),
  }

  const rules: RuleCurationInput[] = []
  const rejected: Array<{ index: number; pair: string; reason: string }> = []
  const notes: string[] = []
  const engineeringNotes: string[] = []

  for (const it of signoff.items) {
    const d = dmap.get(it.index)
    const pair = `${it.source.genericName} × ${[...new Set(it.groups.map((g) => masterById.get(g[0]) ?? g[0]))].join(' / ')}`
    if (!d) {
      notes.push(`#${it.index} 缺少判定，跳过`)
      continue
    }
    if (d.decision === 'reject') {
      rejected.push({ index: it.index, pair, reason: d.reason || '（未填原因）' })
      continue
    }
    const groups = (it.proposedRule.drugGroups ?? it.groups).map((g) => [...g])
    // 工程修正：#12 原文限「口服胺碘酮」，移除注射液，仅保留口服片剂
    if (it.index === 12 && groups[0]) {
      const before = groups[0].length
      groups[0] = groups[0].filter((id) => /片/.test(formById.get(id) ?? ''))
      if (groups[0].length !== before) engineeringNotes.push('#12 原文限口服胺碘酮 → G1 移除注射液，仅保留片剂')
    }
    const drugIds = [...new Set(groups.flat())]
    // 独立命名空间：不能沿用 m10-cand-XX，否则会与第一批已入库规则 ID 冲突（upsert 会覆盖）
    const ruleId = `m11-b2-cand-${String(it.index).padStart(2, '0')}`
    rules.push({
      id: ruleId,
      drugIds,
      drugGroups: groups,
      level: (d.level || it.level) as RuleCurationInput['level'],
      note: it.quote,
      source: `${it.source.genericName}说明书·${it.source.sectionKey}（M11 人工签核）`,
      status: 'curated',
      sourceType: 'manual-interaction',
      sourceRef: it.proposedRule.sourceRef,
      quote: it.quote,
      reviewedBy: decisions.reviewer,
      reviewedAt: decisions.exportedAt,
    })
  }

  const batch = validateRules(rules, ctx)
  const accepted: RuleCurationInput[] = []
  const failed: Array<{ rule: RuleCurationInput; errors: string[] }> = []
  for (const rule of rules) {
    const res = batch.perRule[rule.id] ?? { errors: [], warnings: [] }
    if (res.errors.length === 0) accepted.push(rule)
    else failed.push({ rule, errors: res.errors })
  }
  const batchErrors = batch.errors.filter((e) => !Object.values(batch.perRule).some((r) => r.errors.includes(e)))

  writeFileSync(join(outDir, 'seed-additions-batch2.json'), `${JSON.stringify(accepted, null, 2)}\n`)

  const md: string[] = []
  md.push('# 第二批签核结果导入 dry-run')
  md.push('')
  md.push(`签核人：${decisions.reviewer} · 判定：pass ${decisions.decisions.filter((d) => d.decision === 'pass').length} / edit ${decisions.decisions.filter((d) => d.decision === 'edit').length} / reject ${decisions.decisions.filter((d) => d.decision === 'reject').length}`)
  md.push('')
  md.push(`- 规则草案：**${rules.length}**；守门通过 **${accepted.length}**；未通过 ${failed.length}；拒绝 ${rejected.length}；批次错误 ${batchErrors.length}`)
  md.push('')
  md.push('| id | 级别 | 药对 | quote |')
  md.push('|---|---|---|---|')
  for (const r of accepted) {
    const pair = (r.drugGroups ?? []).map((g) => `${masterById.get(g[0]) ?? g[0]} 等 ${g.length} 个`).join(' × ')
    md.push(`| ${r.id} | ${r.level} | ${pair} | ${(r.quote ?? '').replace(/\|/g, '｜').slice(0, 80)} |`)
  }
  md.push('')
  if (failed.length > 0) {
    md.push('## ❌ 守门失败')
    md.push('')
    for (const f of failed) {
      md.push(`### ${f.rule.id}`)
      f.errors.forEach((e) => md.push(`- ${e}`))
      md.push('')
    }
  }
  md.push('## 说明')
  md.push('')
  if (engineeringNotes.length > 0) {
    md.push('工程修正（签核后的安全收窄）：')
    md.push('')
    engineeringNotes.forEach((n) => md.push(`- ${n}`))
    md.push('')
  }
  md.push('本批为预审修正版（quote/范围/级别已按 `signoff-batch2.precut.md` 更新）；未写库、未改 seed。')
  writeFileSync(join(outDir, 'import-report-batch2.md'), md.join('\n') + '\n')

  console.log(`\n✅ batch2 dry-run：规则 ${rules.length}；通过 ${accepted.length}；失败 ${failed.length}；拒绝 ${rejected.length}；批次错误 ${batchErrors.length}`)
  if (notes.length > 0) console.log(notes.join('\n'))
  return failed.length === 0 && batchErrors.length === 0 ? 0 : 1
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ batch2 导入 dry-run 失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
