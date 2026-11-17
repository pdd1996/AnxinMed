/**
 * M10-T2 · 规则签核清单（20 条窄批，只产出清单，不入库）。
 *
 * 输入：M9 候选池 `data/m9-reports/rule-candidates.jsonl` + `drug_master` + 说明书原文段。
 * 输出：
 *   data/m10-reports/signoff-20.json —— 机读（含 proposedRule 草案、flags、decision 留空）
 *   data/m10-reports/signoff-20.md   —— 人读签核单
 *
 * 纪律：不写 seed、不改库；proposedRule 只是草案（note=quote、status=curated、reviewedBy 留空），
 * 只有签核人逐条确认后才允许另起任务入库。
 */
import 'dotenv/config'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inArray } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import { drugMaster, packageInserts } from '../db/schema.js'
import { baseDrugName } from '../services/rules/candidate-mining.js'
import type { InteractionLevel } from '@anxin/shared'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

interface Candidate {
  sourceInsertId: string
  sourceDrugId: string
  sourceGenericName: string
  version: string | null
  sectionKey: string
  quote: string
  aliases: string[]
  candidateDrugIds: string[]
  candidateGenericNames: string[]
  ambiguous: boolean
  aliasKind: 'full' | 'stripped'
  level: InteractionLevel
  markers: { risk: string[]; noEffect: string[] }
}

interface DrugRow {
  id: string
  genericName: string
  brandName: string | null
  form: string | null
}

const TOPICAL_RE = /滴眼液|眼膏|乳膏|软膏|凝胶剂|凝胶|喷雾剂|鼻喷雾|滴鼻液|滴耳液|洗剂|酊|搽剂|霜|乳(?!酸)|栓|贴剂/
const CLASS_RE = /MAOI|单胺氧化酶|ACE|血管紧张素|大环内酯|β受体|β-受体|钙通道|NSAID|非甾体|抗凝|磺脲|类药物|复方|沙库巴曲/

function conceptKey(name: string): string {
  return baseDrugName(name) || name
}

function conceptForms(drugs: DrugRow[]): string[] {
  return [...new Set(drugs.map((d) => d.form ?? '—'))]
}

function selectTwenty(candidates: Candidate[]): Candidate[] {
  const forbidden = candidates.filter((c) => c.level === '禁忌')
  const caution = candidates.filter((c) => c.level === '慎用')
  const watch = candidates
    .filter((c) => c.level === '需监测')
    .map((c) => {
      const text = c.candidateGenericNames.join(' ') + c.sourceGenericName
      let score = 0
      if (/华法林/.test(text)) score += 5
      if (/地高辛/.test(text)) score += 3
      if (/甲氨蝶呤/.test(text)) score += 3
      if (/达比加群|利伐沙班/.test(text)) score += 2
      return { c, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c)

  const selected: Candidate[] = []
  const seen = new Set<string>()
  for (const c of [...forbidden, ...caution, ...watch]) {
    const key = `${c.sourceDrugId}|${c.quote}`
    if (seen.has(key)) continue
    seen.add(key)
    selected.push(c)
    if (selected.length >= 20) break
  }
  return selected
}

async function main(): Promise<number> {
  const inPath = join(repoRoot, arg('--in') ?? join('data', 'm9-reports', 'rule-candidates.jsonl'))
  const outDir = join(repoRoot, arg('--out') ?? join('data', 'm10-reports'))
  mkdirSync(outDir, { recursive: true })

  const all = readFileSync(inPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Candidate)
  const selected = selectTwenty(all)
  if (selected.length === 0) {
    console.error('❌ 没有可签核候选（先跑 db:rule-candidates）')
    return 1
  }

  const drugRows = (await db
    .select({ id: drugMaster.id, genericName: drugMaster.genericName, brandName: drugMaster.brandName, form: drugMaster.form })
    .from(drugMaster)) as DrugRow[]
  const conceptDrugs = new Map<string, DrugRow[]>()
  for (const d of drugRows) {
    const key = conceptKey(d.genericName)
    const list = conceptDrugs.get(key) ?? []
    list.push(d)
    conceptDrugs.set(key, list)
  }

  const insertIds = [...new Set(selected.map((c) => c.sourceInsertId))]
  const inserts = await db
    .select({ id: packageInserts.id, drugId: packageInserts.drugId, version: packageInserts.version, sourceSections: packageInserts.sourceSections })
    .from(packageInserts)
    .where(inArray(packageInserts.id, insertIds))
  const insertById = new Map(inserts.map((i) => [i.id, i]))

  const items = selected.map((c, index) => {
    const srcConcept = conceptKey(c.sourceGenericName)
    const sourceGroup = (conceptDrugs.get(srcConcept) ?? [{ id: c.sourceDrugId, genericName: c.sourceGenericName, brandName: null, form: null }]).map((d) => d.id)
    const sourceForms = conceptForms(conceptDrugs.get(srcConcept) ?? [])

    const candConcepts = [...new Set(c.candidateGenericNames.map((n) => conceptKey(n)))]
    const candGroups = candConcepts.map((key) => ({
      key,
      ids: (conceptDrugs.get(key) ?? []).map((d) => d.id).filter(Boolean),
      forms: conceptForms(conceptDrugs.get(key) ?? []),
    }))
    const candIds = [...new Set(candGroups.flatMap((g) => (g.ids.length ? g.ids : c.candidateDrugIds)))]
    const candForms = [...new Set(candGroups.flatMap((g) => g.forms))]
    const otherConcepts = [...conceptDrugs.keys()].filter((k) => k.length >= 3 && k !== srcConcept)
    const comboSourceRisk = otherConcepts.some((k) => srcConcept.includes(k))
    const comboCandidateRisk = /沙库巴曲/.test(c.quote) && !candConcepts.some((k) => k.includes('沙库巴曲'))

    const classRisk = CLASS_RE.test(c.quote)
    const topicalSource = sourceForms.some((f) => TOPICAL_RE.test(f))
    const topicalCand = candForms.some((f) => TOPICAL_RE.test(f))
    const topicalContext = /眼|滴眼|外用|局部|涂抹/.test(c.quote)
    const routeRisk = (topicalSource || topicalCand) && !topicalContext
    const oralQuote = /口服/.test(c.quote)
    const injectionOnly = candForms.length > 0 && candForms.every((f) => /注射|粉针|冻干/.test(f))
    const routeMismatch = oralQuote && injectionOnly

    // 概念组建议：类别句（MAOI/ACEI/大环内酯…）把候选合并为 any-of 组；普通双药按各自概念组
    const proposedGroups = classRisk
      ? [sourceGroup, candIds]
      : [sourceGroup, ...candGroups.map((g) => (g.ids.length ? g.ids : c.candidateDrugIds))]
    const drugIds = [...new Set(proposedGroups.flat())]

    const insert = insertById.get(c.sourceInsertId)
    const sectionText = insert?.sourceSections?.[c.sectionKey] ?? ''
    const verbatimOk = sectionText.includes(c.quote)
    const flags: string[] = []
    if (routeRisk) flags.push('routeRisk: 剂型/途径可能不匹配')
    if (routeMismatch) flags.push('routeMismatch: 原文限定口服但候选仅注射剂')
    if (classRisk) flags.push('classRisk: 类别/复方语境，候选合并为 any-of 组')
    if (comboSourceRisk) flags.push('comboSourceRisk: 来源药是复方，需改按实际对象药建组')
    if (comboCandidateRisk) flags.push('comboCandidateRisk: 原文含复方成分，候选概念可能不完整')
    if (c.ambiguous) flags.push('ambiguous: 同成分多产品')
    if (c.aliasKind === 'stripped') flags.push('stripped: 仅归一别名命中，需核原文')
    if (!verbatimOk) flags.push('VERBATIM_FAILED')

    return {
      index: index + 1,
      level: c.level,
      source: {
        insertId: c.sourceInsertId,
        drugId: c.sourceDrugId,
        genericName: c.sourceGenericName,
        version: c.version ?? insert?.version ?? null,
        sectionKey: c.sectionKey,
      },
      quote: c.quote,
      candidate: {
        genericNames: c.candidateGenericNames,
        conceptKeys: candConcepts,
        drugIds: candIds,
        forms: candForms,
        ambiguous: c.ambiguous,
      },
      groups: proposedGroups,
      drugIds,
      flags,
      verbatimOk,
      proposedRule: {
        id: `m10-cand-${String(index + 1).padStart(2, '0')}`,
        drugIds,
        drugGroups: proposedGroups,
        level: c.level,
        note: c.quote,
        quote: c.quote,
        source: `${c.sourceGenericName}说明书·${c.sectionKey}（M9 候选，待人工签核）`,
        status: 'curated',
        sourceType: 'manual-interaction',
        sourceRef: JSON.stringify({ insertId: c.sourceInsertId, drugId: c.sourceDrugId, sectionKey: c.sectionKey, version: c.version ?? insert?.version ?? null }),
        reviewedBy: '',
        reviewedAt: null,
      },
      decision: 'pending',
      decisionNote: '',
    }
  })

  const byLevel = items.reduce<Record<string, number>>((acc, it) => {
    acc[it.level] = (acc[it.level] ?? 0) + 1
    return acc
  }, {})
  const flagCounts: Record<string, number> = {}
  for (const it of items) {
    for (const flag of ['routeRisk', 'routeMismatch', 'classRisk', 'comboSourceRisk', 'comboCandidateRisk', 'ambiguous', 'stripped', 'VERBATIM_FAILED']) {
      if (it.flags.some((f) => f.startsWith(flag))) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    source: inPath,
    totalSelected: items.length,
    byLevel,
    flagCounts,
    flagged: items.filter((it) => it.flags.length > 0).length,
    verbatimFailures: items.filter((it) => !it.verbatimOk).length,
    items,
    note: '只产出签核清单；proposedRule 是草案，reviewedBy 空白；签核人逐条 pass/改判/reject 后才另起入库任务。',
  }
  writeFileSync(join(outDir, 'signoff-20.json'), `${JSON.stringify(report, null, 2)}\n`)

  const md: string[] = []
  md.push('# M10-T2 · 规则签核清单（20 条窄批）')
  md.push('')
  md.push(`生成：${report.generatedAt} · 来源候选池：${all.length} 条 · 本批 **${items.length}** 条（禁忌 ${byLevel['禁忌'] ?? 0} / 慎用 ${byLevel['慎用'] ?? 0} / 需监测 ${byLevel['需监测'] ?? 0}）`)
  md.push('')
  md.push('> 只产出清单，**未入库、未写 seed**。`proposedRule` 是草案（note=quote、reviewedBy 留空）；请在「判定」栏写 `pass` / `改判：…` / `reject：…`。')
  md.push('- flags 统计：' + Object.entries(flagCounts).map(([k, v]) => `${k}=${v}`).join(' / '))
  md.push('')
  md.push('## 逐条')
  md.push('')
  items.forEach((it) => {
    md.push(`### ${it.index}. ${it.source.genericName} × ${[...new Set(it.candidate.genericNames)].join(' / ')}（${it.level}）`)
    md.push('')
    md.push(`- 来源：\`${it.source.insertId}\` · ${it.source.genericName} · ${it.source.version ?? '—'} · 段：${it.source.sectionKey}`)
    md.push(`- 原文（逐字）：${it.quote}`)
    md.push(`- 概念组：${it.groups.map((g, i) => `G${i + 1}=[${g.length} 个产品]`).join(' / ')}；drugIds ${it.drugIds.length} 个`)
    md.push(`- 候选剂型：${it.candidate.forms.join(' / ') || '—'}`)
    md.push(`- flags：${it.flags.join('；') || '无'}`)
    md.push(`- 判定：\`pending\`（pass / 改判：____ / reject：____）`)
    md.push('')
  })
  md.push('## 批量签核后的入库流程')
  md.push('')
  md.push('1. 把 pass 条目按 `proposedRule` 写入 `seed-interaction-rules.json`，补 `reviewedBy`/`reviewedAt`；')
  md.push('2. `db:seed-interaction-rules --check` 必须全过（逐字/来源/概念组一致性）；')
  md.push('3. `--apply` 后再跑 `db:audit` 与规则命中测试；')
  md.push('4. 本批之外的候选仍留在候选池，不自动入库。')
  writeFileSync(join(outDir, 'signoff-20.md'), md.join('\n') + '\n')

  console.log(`\n✅ 签核清单：${items.length} 条（禁忌 ${byLevel['禁忌'] ?? 0} / 慎用 ${byLevel['慎用'] ?? 0} / 需监测 ${byLevel['需监测'] ?? 0}）`)
  console.log(`   flags：${JSON.stringify(flagCounts)}；逐字失败 ${report.verbatimFailures} 条`)
  console.log(`   输出：${join(outDir, 'signoff-20.json')} / signoff-20.md`)
  return report.verbatimFailures === 0 ? 0 : 1
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 签核清单生成失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
