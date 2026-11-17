/**
 * M10-T3 · 签核结果 → seed 草案（dry-run，不写库、不改 seed）。
 *
 * 读：data/review-manual/signoff-20-decisions.corrected.json + data/m10-reports/signoff-20.json
 * 出：data/m10-reports/seed-additions.json / import-dryrun.json / import-report.md
 *
 * 只处理 pass / edit；reject 不进规则。所有规则必须过 rule-curation 守门
 * （逐字、来源 reviewed、概念组一致、reviewedBy 非空）。人工确认后才另跑 apply。
 */
import '../lib/env.js'
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

interface SignoffItem {
  index: number
  level: string
  quote: string
  quoteOriginal: string
  quotePrefix?: string
  source: { insertId: string; drugId: string; genericName: string; version: string | null; sectionKey: string }
  candidate: { genericNames: string[]; conceptKeys: string[]; drugIds: string[]; forms: string[]; ambiguous: boolean }
  groups: string[][]
  drugIds: string[]
  flags: string[]
  proposedRule: {
    id: string
    drugIds: string[]
    drugGroups: string[][]
    level: string
    note: string
    quote: string
    source: string
    status: 'curated'
    sourceType: string
    sourceRef: string
    reviewedBy: string
    reviewedAt: string | null
  }
}

interface DrugRow {
  id: string
  genericName: string
  form: string | null
}

function idsOf(rows: DrugRow[], re: RegExp, formRe?: RegExp): string[] {
  return rows.filter((d) => re.test(d.genericName) && (!formRe || formRe.test(d.form ?? ''))).map((d) => d.id)
}

function withSource(ids: string[], sourceId: string): string[] {
  return ids.includes(sourceId) ? ids : [...ids, sourceId]
}

async function main(): Promise<number> {
  const decisionsPath = resolvePath(arg('--decisions') ?? join('data', 'review-manual', 'signoff-20-decisions.corrected.json'))
  const signoffPath = resolvePath(arg('--signoff') ?? join('data', 'm10-reports', 'signoff-20.json'))
  const outDir = resolvePath(arg('--out') ?? join('data', 'm10-reports'))
  mkdirSync(outDir, { recursive: true })

  const decisions = JSON.parse(readFileSync(decisionsPath, 'utf8')) as {
    reviewer: string
    exportedAt: string
    decisions: Decision[]
  }
  const signoff = JSON.parse(readFileSync(signoffPath, 'utf8')) as { items: SignoffItem[] }
  const dmap = new Map(decisions.decisions.map((d) => [d.index, d]))

  const masterRows = (await db
    .select({ id: drugMaster.id, genericName: drugMaster.genericName, form: drugMaster.form })
    .from(drugMaster)) as DrugRow[]
  const masterById = new Map(masterRows.map((d) => [d.id, d]))

  const insertIds = [...new Set(signoff.items.map((it) => it.source.insertId))]
  const inserts = await db
    .select({
      id: packageInserts.id,
      drugId: packageInserts.drugId,
      curationStatus: packageInserts.curationStatus,
      version: packageInserts.version,
      sourceSections: packageInserts.sourceSections,
    })
    .from(packageInserts)
    .where(inArray(packageInserts.id, insertIds))
  const insertById = new Map(inserts.map((i) => [i.id, i]))

  const existingRules = await db
    .select({ id: interactionRules.id, drugIds: interactionRules.drugIds, drugGroups: interactionRules.drugGroups, status: interactionRules.status })
    .from(interactionRules)

  const manualsByInsertId: Record<string, ManualSnapshot> = {}
  for (const ins of inserts) {
    manualsByInsertId[ins.id] = {
      insertId: ins.id,
      drugId: ins.drugId,
      curationStatus: ins.curationStatus,
      sections: ins.sourceSections ?? {},
    }
  }
  const ctx: RuleCurationContext = {
    existingDrugMasterIds: masterRows.map((d) => d.id),
    manualsByInsertId,
    existingRules: existingRules.map((r) => ({
      id: r.id,
      drugIds: (r.drugIds as string[] | null) ?? [],
      drugGroups: (r.drugGroups as string[][] | null) ?? null,
      status: r.status,
    })),
  }

  const amlodipinePlainIds = masterRows
    .filter((d) => /^(苯磺酸氨氯地平|门冬氨酸氨氯地平)/.test(d.genericName) && !/左/.test(d.genericName))
    .map((d) => d.id)
  const tacrolimusCapsuleIds = idsOf(masterRows, /他克莫司/, /胶囊/)
  const erythromycinInjectionIds = idsOf(masterRows, /红霉素/, /注射/)
  const ibuprofenOralIds = idsOf(masterRows, /布洛芬/, /^(?!.*乳膏).*$/)
  const digoxinIds = idsOf(masterRows, /地高辛/)
  const methotrexateIds = idsOf(masterRows, /甲氨蝶呤/)
  const linezolidInjectionIds = idsOf(masterRows, /利奈唑胺/, /注射液/)

  const rules: RuleCurationInput[] = []
  const rejected: Array<{ index: number; pair: string; reason: string }> = []
  const notes: Array<{ index: number; note: string }> = []
  const ruleNotes: Array<{ index: number; note: string }> = []
  const quoteFixUps: Array<{ index: number; from: string; to: string }> = []

  for (const it of signoff.items) {
    const d = dmap.get(it.index)
    const pair = `${it.source.genericName} × ${[...new Set(it.candidate.genericNames)].join(' / ')}`
    if (!d) {
      notes.push({ index: it.index, note: '缺少判定，跳过' })
      continue
    }
    if (d.decision === 'reject') {
      rejected.push({ index: it.index, pair, reason: d.reason || '（未填原因）' })
      continue
    }

    const insert = insertById.get(it.source.insertId)
    const section = insert?.sourceSections?.[it.source.sectionKey] ?? ''
    let quote = it.quote
    if (it.quotePrefix) {
      const combined = it.quotePrefix + it.quote
      if (normalizeQuoteText(section).includes(normalizeQuoteText(combined))) {
        quote = combined
        quoteFixUps.push({ index: it.index, from: it.quote, to: combined })
      } else {
        notes.push({ index: it.index, note: `引文前缀无法拼回原文段，保留原 quote（${it.quote.slice(0, 20)}…）` })
      }
    }

    let groups = it.groups.map((g) => [...g])
    if (it.index === 4) {
      groups = groups.map((g) =>
        g.some((id) => (masterById.get(id)?.genericName ?? '').includes('利奈唑胺'))
          ? [...new Set([...g, ...linezolidInjectionIds])]
          : g,
      )
    } else if (it.index === 7) {
      // 原文来自复方说明书；规则按「氨氯地平（普通制剂）+ 源复方产品」建组，其他复方待专业确认
      groups = [[...withSource(amlodipinePlainIds, it.source.drugId)], tacrolimusCapsuleIds]
    } else if (it.index === 11) {
      groups = [groups[0], erythromycinInjectionIds]
    } else if (it.index === 14) {
      groups = [ibuprofenOralIds, [...digoxinIds, ...methotrexateIds]]
    } else if (it.index === 18) {
      groups = [groups[0], erythromycinInjectionIds]
    }
    groups = groups.filter((g) => g.length > 0)
    const drugIds = [...new Set(groups.flat())]
    if (d.note && d.note.trim()) ruleNotes.push({ index: it.index, note: d.note })

    rules.push({
      id: it.proposedRule.id,
      drugIds,
      drugGroups: groups,
      level: d.level || it.level,
      note: quote,
      source: `${it.source.genericName}说明书·${it.source.sectionKey}（M10 人工签核）`,
      status: 'curated',
      sourceType: 'manual-interaction',
      sourceRef: it.proposedRule.sourceRef,
      quote,
      reviewedBy: decisions.reviewer,
      reviewedAt: decisions.exportedAt,
    } as RuleCurationInput)
  }

  const batch = validateRules(rules, ctx)
  const accepted: RuleCurationInput[] = []
  const failed: Array<{ rule: RuleCurationInput; errors: string[]; warnings: string[] }> = []
  for (const rule of rules) {
    const res = batch.perRule[rule.id] ?? { errors: [], warnings: [] }
    if (res.errors.length === 0) accepted.push(rule)
    else failed.push({ rule, errors: res.errors, warnings: res.warnings })
  }
  const batchErrors = batch.errors.filter((e) => !Object.values(batch.perRule).some((r) => r.errors.includes(e)))

  const summary = {
    generatedAt: new Date().toISOString(),
    decisions: decisionsPath,
    reviewer: decisions.reviewer,
    counts: {
      pass: decisions.decisions.filter((d) => d.decision === 'pass').length,
      edit: decisions.decisions.filter((d) => d.decision === 'edit').length,
      reject: decisions.decisions.filter((d) => d.decision === 'reject').length,
    },
    plannedRules: rules.length,
    accepted: accepted.length,
    failed: failed.length,
    rejected: rejected.length,
    quoteFixUps,
    batchErrors,
    notes,
  }

  // 机器可读：seed 追加草案
  writeFileSync(join(outDir, 'seed-additions.json'), `${JSON.stringify(accepted, null, 2)}\n`)
  writeFileSync(
    join(outDir, 'import-dryrun.json'),
    `${JSON.stringify(
      {
        ...summary,
        accepted: accepted.map((r) => ({ id: r.id, level: r.level, drugIds: r.drugIds, drugGroups: r.drugGroups, quote: r.quote })),
        rejected,
        failed,
        warnings: batch.warnings,
      },
      null,
      2,
    )}
`,
  )

  const md: string[] = []
  md.push('# M10 · 签核结果导入 dry-run')
  md.push('')
  md.push(`判定来源：\`${decisionsPath}\``)
  md.push(`签核人：${decisions.reviewer} · 导出时间：${decisions.exportedAt}`)
  md.push('')
  md.push(`- 判定：**pass ${summary.counts.pass} / edit ${summary.counts.edit} / reject ${summary.counts.reject}**`)
  md.push(`- 生成规则草案：**${rules.length}** 条；守门通过 **${accepted.length}** 条；未通过 ${failed.length} 条`)
  md.push(`- 拒绝（不入库）：${rejected.length} 条；引文补全：${quoteFixUps.length} 条`)
  md.push(`- 批次级错误（重复药对等）：${batchErrors.length} 条`)
  md.push('')
  if (batchErrors.length > 0) {
    md.push('## ❌ 批次级错误（必须先修）')
    md.push('')
    batchErrors.forEach((e) => md.push(`- ${e}`))
    md.push('')
  }
  md.push('## 通过守门的规则（待 apply）')
  md.push('')
  md.push('| id | 级别 | 药对（概念组） | quote |')
  md.push('|---|---|---|---|')
  for (const r of accepted) {
    const pair = (r.drugGroups ?? [])
      .map((g) => {
        const names = [...new Set(g.map((id) => masterById.get(id)?.genericName ?? id))]
        return names.length <= 1 ? names[0] : `${names[0]} 等 ${g.length} 个产品`
      })
      .join(' × ')
    md.push(`| ${r.id} | ${r.level} | ${pair} | ${(r.quote ?? '').replace(/\|/g, '｜').slice(0, 80)} |`)
  }
  md.push('')
  if (failed.length > 0) {
    md.push('## ❌ 未通过守门的规则')
    md.push('')
    failed.forEach((f) => {
      md.push(`### ${f.rule.id}`)
      f.errors.forEach((e) => md.push(`- ${e}`))
      md.push('')
    })
  }
  md.push('## 拒绝（不入库）')
  md.push('')
  for (const r of rejected) md.push(`- #${r.index} ${r.pair}：${r.reason}`)
  md.push('')
  if (ruleNotes.length > 0) {
    md.push('## 已知覆盖缺口 / 签核备注（来自判定说明）')
    md.push('')
    for (const n of ruleNotes) md.push(`- #${n.index}：${n.note}`)
    md.push('')
  }
  if (notes.length > 0) {
    md.push('## 备注 / 缺口')
    md.push('')
    for (const n of notes) md.push(`- #${n.index}：${n.note}`)
    md.push('')
  }
  md.push('## 下一步')
  md.push('')
  md.push('1. 确认本 dry-run 的规则清单与 quote；')
  md.push('2. 人工确认后，把 `seed-additions.json` 合并进 `seed-interaction-rules.json` 并跑 `db:seed-interaction-rules --check`；')
  md.push('3. `--apply` 后再跑 `db:audit`、命中测试与全量回归。')
  writeFileSync(join(outDir, 'import-report.md'), md.join('\n') + '\n')

  console.log(`\n✅ dry-run 完成`)
  console.log(`   判定：pass ${summary.counts.pass} / edit ${summary.counts.edit} / reject ${summary.counts.reject}`)
  console.log(`   规则草案 ${rules.length}；守门通过 ${accepted.length}；未通过 ${failed.length}；拒绝 ${rejected.length}`)
  console.log(`   批次错误 ${batchErrors.length}；引文补全 ${quoteFixUps.length}`)
  console.log(`   输出：${join(outDir, 'import-report.md')} / seed-additions.json / import-dryrun.json`)
  return batchErrors.length === 0 && failed.length === 0 ? 0 : 1
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 导入 dry-run 失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
