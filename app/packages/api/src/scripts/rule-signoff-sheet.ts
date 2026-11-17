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
import { baseDrugName, expandQuoteToSentence } from '../services/rules/candidate-mining.js'
import { normalizeQuoteText } from '../services/rules/rule-curation.js'
import type { InteractionLevel } from '@anxin/shared'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')

function resolvePath(p: string): string {
  return /^[A-Za-z]:[\\/]|^\//.test(p) ? p : join(repoRoot, p)
}

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
  const outDir = join(repoRoot, arg('--out') ?? join('data', 'm10-reports'))
  mkdirSync(outDir, { recursive: true })

  // 只重渲染已有 report JSON（预审修正版签核页用），不重新选候选/不查库
  const rerender = arg('--rerender')
  if (rerender) {
    const report = JSON.parse(readFileSync(resolvePath(rerender), 'utf8'))
    const prefix = arg('--out-prefix') ?? 'signoff-rerender'
    writeFileSync(join(outDir, `${prefix}.html`), renderReviewHtml(report))
    console.log(`✅ 已重渲染签核页：${join(outDir, `${prefix}.html`)}（${report.items?.length ?? 0} 条）`)
    return 0
  }

  const inPath = join(repoRoot, arg('--in') ?? join('data', 'm9-reports', 'rule-candidates.jsonl'))

  const all = readFileSync(inPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Candidate)
  const indicesArg = arg('--indices')
  const selected = indicesArg
    ? indicesArg
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0)
        .map((i) => all[i])
        .filter((c): c is Candidate => Boolean(c))
    : selectTwenty(all)
  if (selected.length === 0) {
    console.error('❌ 没有可签核候选（先跑 db:rule-candidates）')
    return 1
  }
  const outPrefix = arg('--out-prefix') ?? 'signoff-20'
  const batchLabel = `${selected.length} 条窄批`

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

    // 候选 quote 可能被 PDF OCR 换行截断（如「应慎用胺」）；扩到完整句再展示/入库。
    const insert = insertById.get(c.sourceInsertId)
    const sectionText = insert?.sourceSections?.[c.sectionKey] ?? ''
    const expandedRaw = expandQuoteToSentence(sectionText, c.quote)
    const quoteText = (expandedRaw ?? c.quote).replace(/[\r\n]+/g, '')
    const quoteExpanded = quoteText !== c.quote
    const rawPos = sectionText.indexOf(c.quote)
    let quoteStartMid = false
    if (rawPos > 0) {
      let j = rawPos - 1
      while (j >= 0 && /\s/.test(sectionText[j])) j--
      const prev = j >= 0 ? sectionText[j] : ''
      quoteStartMid = prev !== '' && !/[。；;！？!?]/.test(prev)
    }
    let lastBound = -1
    for (const b of ['。', '；', ';', '！', '？', '!', '?']) {
      const i = sectionText.lastIndexOf(b, rawPos - 1)
      if (i > lastBound) lastBound = i
    }
    const quotePrefix = quoteStartMid && rawPos > 0
      ? sectionText.slice(lastBound + 1, rawPos).replace(/[\r\n]+/g, '').trim()
      : ''

    const otherConcepts = [...conceptDrugs.keys()].filter((k) => k.length >= 3 && k !== srcConcept)
    const comboSourceRisk = otherConcepts.some((k) => srcConcept.includes(k))
    const comboCandidateRisk = /沙库巴曲/.test(quoteText) && !candConcepts.some((k) => k.includes('沙库巴曲'))

    const classRisk = CLASS_RE.test(quoteText)
    const topicalSource = sourceForms.some((f) => TOPICAL_RE.test(f))
    const topicalCand = candForms.some((f) => TOPICAL_RE.test(f))
    const topicalContext = /眼|滴眼|外用|局部|涂抹/.test(quoteText)
    const routeRisk = (topicalSource || topicalCand) && !topicalContext
    const oralQuote = /口服/.test(quoteText)
    const injectionOnly = candForms.length > 0 && candForms.every((f) => /注射|粉针|冻干/.test(f))
    const routeMismatch = oralQuote && injectionOnly

    // 概念组建议：类别句（MAOI/ACEI/大环内酯…）把候选合并为 any-of 组；普通双药按各自概念组
    const proposedGroups = classRisk
      ? [sourceGroup, candIds]
      : [sourceGroup, ...candGroups.map((g) => (g.ids.length ? g.ids : c.candidateDrugIds))]
    const drugIds = [...new Set(proposedGroups.flat())]

    const verbatimOk = normalizeQuoteText(sectionText).includes(normalizeQuoteText(expandedRaw ?? c.quote))
    const flags: string[] = []
    if (quoteExpanded) flags.push('quoteExpanded: 引文已扩到完整句，需复核语义范围')
    if (quoteStartMid) flags.push('quoteStartMid: 引文起点可能被换行截断，需补全前半句')
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
      quote: quoteText,
      quoteOriginal: c.quote,
      quotePrefix,
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
        note: quoteText,
        quote: quoteText,
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

  const allGroupIds = [...new Set(items.flatMap((it) => it.groups.flat()))]
  const groupRows = await db
    .select({ id: drugMaster.id, genericName: drugMaster.genericName, brandName: drugMaster.brandName, form: drugMaster.form })
    .from(drugMaster)
    .where(inArray(drugMaster.id, allGroupIds))
  const groupById = new Map(groupRows.map((d) => [d.id, d]))
  const groupDetails = items.map((it) =>
    it.groups.map((group) =>
      group.map((id) => {
        const d = groupById.get(id)
        return { id, genericName: d?.genericName ?? id, brandName: d?.brandName ?? null, form: d?.form ?? null }
      }),
    ),
  )

  const byLevel = items.reduce<Record<string, number>>((acc, it) => {
    acc[it.level] = (acc[it.level] ?? 0) + 1
    return acc
  }, {})
  const flagCounts: Record<string, number> = {}
  for (const it of items) {
    for (const flag of ['quoteExpanded', 'quoteStartMid', 'routeRisk', 'routeMismatch', 'classRisk', 'comboSourceRisk', 'comboCandidateRisk', 'ambiguous', 'stripped', 'VERBATIM_FAILED']) {
      if (it.flags.some((f) => f.startsWith(flag))) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    batchId: outPrefix,
    batchLabel,
    source: inPath,
    totalSelected: items.length,
    byLevel,
    flagCounts,
    flagged: items.filter((it) => it.flags.length > 0).length,
    verbatimFailures: items.filter((it) => !it.verbatimOk).length,
    items,
    groupDetails,
    note: '只产出签核清单；proposedRule 是草案，reviewedBy 空白；签核人逐条 pass/改判/reject 后才另起入库任务。',
  }
  writeFileSync(join(outDir, `${outPrefix}.json`), `${JSON.stringify(report, null, 2)}\n`)

  const md: string[] = []
  md.push(`# 规则签核清单（${batchLabel}）`)
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
  writeFileSync(join(outDir, `${outPrefix}.md`), md.join('\n') + '\n')
  writeFileSync(join(outDir, `${outPrefix}.html`), renderReviewHtml(report))

  console.log(`\n✅ 签核清单：${items.length} 条（禁忌 ${byLevel['禁忌'] ?? 0} / 慎用 ${byLevel['慎用'] ?? 0} / 需监测 ${byLevel['需监测'] ?? 0}）`)
  console.log(`   flags：${JSON.stringify(flagCounts)}；逐字失败 ${report.verbatimFailures} 条`)
  console.log(`   输出：${join(outDir, `${outPrefix}.json`)} / ${outPrefix}.md / ${outPrefix}.html`)
  return report.verbatimFailures === 0 ? 0 : 1
}

/** 生成自包含签核页（file:// 直接打开；决策存 localStorage，可导出 JSON）。 */
function renderReviewHtml(report: unknown): string {
  const payload = JSON.stringify(report).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>规则签核清单</title>
<style>
  :root { --bg:#f6f5f2; --card:#fffdf9; --ink:#1f2933; --muted:#6b7280; --line:#e5e0d8; --accent:#2f6f5e; --warn:#b45309; --bad:#b91c1c; --chip:#f1ede5; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
  header { position:sticky; top:0; z-index:5; background:rgba(246,245,242,.97); border-bottom:1px solid var(--line); padding:12px 20px 10px; backdrop-filter:blur(8px); box-shadow:0 1px 0 rgba(0,0,0,.02); }
  .head-inner, .foot-inner { max-width:980px; margin:0 auto; }
  .head-top { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
  h1 { font-size:18px; margin:0 0 3px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .batch { font-size:11px; font-weight:600; color:var(--accent); background:#e8f1ed; border:1px solid #cfe2da; border-radius:999px; padding:1px 8px; }
  .meta { color:var(--muted); font-size:13px; }
  .head-actions { display:flex; gap:8px; align-items:center; }
  .bar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:10px; }
  .field { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--muted); white-space:nowrap; }
  .bar input, .bar select { padding:6px 9px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--ink); font:inherit; }
  button { border:1px solid var(--line); background:#fff; border-radius:8px; padding:6px 10px; cursor:pointer; color:var(--ink); font:inherit; }
  button:hover { border-color:#cfc7ba; background:#fbf8f2; }
  button.ghost { background:transparent; }
  button.primary { background:var(--accent); color:#fff; border-color:var(--accent); font-weight:600; padding:8px 14px; }
  button.primary:hover { background:#275c4e; border-color:#275c4e; }
  .progress { display:flex; gap:6px; flex-wrap:wrap; margin-left:auto; align-items:center; }
  .stat { font-size:12px; border-radius:999px; padding:2px 9px; background:#fff; border:1px solid var(--line); color:#4b5563; white-space:nowrap; }
  .stat b { font-weight:700; }
  .stat.ok { background:#e6f4ea; border-color:#cfe6d8; color:#1e6b3a; }
  .stat.warn { background:#fef3e2; border-color:#f5dfc0; color:#92400e; }
  .stat.bad { background:#fde8e8; border-color:#f3cfcf; color:#9b1c1c; }
  main { max-width:980px; margin:0 auto; padding:18px 16px 96px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:14px 0; box-shadow:0 1px 2px rgba(0,0,0,.03); scroll-margin-top:150px; }
  .card.risk { border-left:4px solid var(--warn); }
  .card.bad { border-left:4px solid var(--bad); }
  .row { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
  .idx { font-weight:700; color:var(--muted); }
  .level { font-weight:700; padding:1px 8px; border-radius:999px; background:#efe9df; font-size:13px; }
  .level.禁忌 { background:#fde8e8; color:#9b1c1c; }
  .level.慎用 { background:#fef3e2; color:#92400e; }
  .level.需监测 { background:#e8f1fd; color:#1e4f91; }
  .pair { font-weight:700; }
  blockquote { margin:10px 0; padding:10px 12px; background:#faf7f1; border-left:3px solid var(--line); color:#333; }
  .muted { color:var(--muted); font-size:13px; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; margin:6px 0; }
  .chip { background:var(--chip); border-radius:999px; padding:1px 8px; font-size:12px; color:#4b5563; }
  .chip.warn { background:#fef3e2; color:#92400e; }
  .group { font-size:13px; margin:4px 0; }
  .pill { display:inline-block; background:#f6f2ea; border:1px solid var(--line); border-radius:6px; padding:0 6px; margin:2px 4px 2px 0; font-size:12px; }
  .decision { border-top:1px dashed var(--line); margin-top:12px; padding-top:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .decision .state { font-size:13px; color:var(--muted); }
  textarea { width:100%; min-height:56px; padding:8px; border:1px solid var(--line); border-radius:8px; font:inherit; }
  .editbox { display:grid; gap:8px; margin-top:8px; }
  .toc { position:fixed; left:0; top:0; bottom:0; width:360px; max-width:90vw; z-index:30; background:#fffdf9; border-right:1px solid var(--line); box-shadow:8px 0 30px rgba(0,0,0,.12); transform:translateX(-105%); transition:transform .18s ease; overflow:auto; padding:16px 14px 60px; }
  .toc.open { transform:none; }
  .toc h2 { font-size:15px; margin:0 0 10px; display:flex; justify-content:space-between; align-items:center; }
  .toc h2 button { border:1px solid var(--line); background:#fff; border-radius:8px; padding:4px 8px; cursor:pointer; }
  .toc .counts { color:var(--muted); font-size:12px; margin-bottom:10px; }
  .toc button.item { display:grid; grid-template-columns:34px auto 1fr auto; gap:6px; align-items:center; width:100%; text-align:left; border:1px solid transparent; background:transparent; border-radius:8px; padding:7px 6px; cursor:pointer; font:inherit; color:inherit; }
  .toc button.item:hover { background:#f3efe7; border-color:var(--line); }
  .toc .n { color:var(--muted); font-size:12px; }
  .toc .nm { font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .toc .st { font-size:11px; border-radius:999px; padding:0 7px; background:#f1ede5; color:#6b7280; white-space:nowrap; }
  .toc .st.pass { background:#e6f4ea; color:#1e6b3a; }
  .toc .st.edit { background:#fef3e2; color:#92400e; }
  .toc .st.reject { background:#fde8e8; color:#9b1c1c; }
  #backdrop { position:fixed; inset:0; z-index:20; background:rgba(20,20,20,.28); opacity:0; pointer-events:none; transition:opacity .18s ease; }
  #backdrop.show { opacity:1; pointer-events:auto; }
  .card.flash { outline:2px solid var(--accent); outline-offset:2px; }
  footer { position:fixed; bottom:0; left:0; right:0; z-index:10; background:rgba(246,245,242,.97); border-top:1px solid var(--line); padding:10px 20px; display:flex; justify-content:space-between; align-items:center; gap:14px; font-size:13px; backdrop-filter:blur(8px); }
  .foot-left { display:flex; flex-direction:column; gap:1px; min-width:0; }
  .remaining { font-weight:600; font-size:13px; }
  .remaining.pending { color:var(--warn); }
  .remaining.done { color:var(--accent); }
  .foot-actions { display:flex; gap:8px; align-items:center; flex-shrink:0; }
  #hint { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  @media (max-width:640px) { .progress { margin-left:0; } .head-top { flex-direction:column; } footer { align-items:flex-start; } }
</style>
</head>
<body>
<header>
  <div class="head-inner">
  <div class="head-top">
    <div>
      <h1>规则签核清单 <span class="batch" id="batchLabel">20 条窄批</span></h1>
      <div class="meta">只做人工签核，不写库。通过 = 你确认「原文逐字、分级合理、概念组不误伤」；改判/拒绝请写清原因。</div>
    </div>
    <div class="head-actions">
      <button id="tocToggle" class="ghost" title="显示/隐藏目录">目录</button>
    </div>
  </div>
  <div class="bar">
    <label class="field">签核人 <input id="reviewer" placeholder="姓名/工号" /></label>
    <label class="field">筛选 <select id="filter"><option value="all">全部</option><option>禁忌</option><option>慎用</option><option>需监测</option></select></label>
    <div id="progress" class="progress"></div>
  </div>
  </div>
</header>
<main id="cards"></main>
<aside id="toc" class="toc" aria-label="目录">
  <h2>目录 <button id="tocClose">收起</button></h2>
  <div class="counts" id="tocCounts"></div>
  <div id="tocList"></div>
</aside>
<div id="backdrop"></div>
<footer>
  <div class="foot-inner" style="display:flex;justify-content:space-between;align-items:center;gap:14px;width:100%">
  <div class="foot-left">
    <span id="remaining" class="remaining pending"></span>
    <span id="hint" class="muted"></span>
  </div>
  <div class="foot-actions">
    <button id="reset" class="ghost">重置</button>
    <button id="export" class="primary">导出 decisions JSON</button>
  </div>
  </div>
</footer>
<script id="report" type="application/json">${payload}</script>
<script>
(function () {
  var report = JSON.parse(document.getElementById('report').textContent);
  document.getElementById('batchLabel').textContent = report.batchLabel || '规则签核';
  // 批次隔离的 localStorage key：不同批次签核页不能复用同一份进度（否则会把上一批判定套到新条目上）
  var KEY = 'anxin-signoff-' + (report.batchId || 'default');
  var LEVELS = ['禁忌', '慎用', '需监测', '注意'];
  var FLAG_HELP = {
    quoteExpanded: '引文已扩到完整句，需复核语义范围',
    quoteStartMid: '引文起点可能被换行截断，需补全前半句',
    routeRisk: '概念组含局部剂型，需缩组或改判',
    routeMismatch: '原文限定口服，但候选剂型不含口服',
    classRisk: '类别/复方语境，候选合并成 any-of 组是否合适需确认',
    comboSourceRisk: '来源药是复方，应改按实际对象药建组',
    comboCandidateRisk: '原文含复方成分，候选概念可能不完整',
    ambiguous: '同成分多产品，需确认具体产品组',
    stripped: '仅归一别名命中，需核对原文与剂型',
    VERBATIM_FAILED: '逐字校验失败，禁止通过'
  };
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }
  var reviewer = localStorage.getItem(KEY + '-reviewer') || '';
  document.getElementById('reviewer').value = reviewer;
  var tocOpen = localStorage.getItem(KEY + '-toc') === 'open';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(KEY + '-reviewer', document.getElementById('reviewer').value.trim()); }
  function counts() {
    var pass = 0, edit = 0, reject = 0;
    report.items.forEach(function (it) { var s = state[it.index]; if (!s || !s.decision) return; if (s.decision === 'pass') pass++; else if (s.decision === 'edit') edit++; else reject++; });
    return { done: pass + edit + reject, pass: pass, edit: edit, reject: reject };
  }
  function setToc(open) {
    tocOpen = !!open;
    document.getElementById('toc').classList.toggle('open', tocOpen);
    document.getElementById('backdrop').classList.toggle('show', tocOpen);
    document.getElementById('tocToggle').textContent = tocOpen ? '目录 ×' : '目录';
    localStorage.setItem(KEY + '-toc', tocOpen ? 'open' : 'closed');
  }
  function renderToc() {
    var c = counts();
    document.getElementById('tocCounts').textContent = '已处理 ' + c.done + '/' + report.items.length + ' · 通过 ' + c.pass + ' / 改判 ' + c.edit + ' / 拒绝 ' + c.reject;
    var html = report.items.map(function (it) {
      var s = state[it.index] || {};
      var st = s.decision === 'pass' ? '已通过' : s.decision === 'edit' ? '待改判' : s.decision === 'reject' ? '已拒绝' : '未处理';
      var stCls = s.decision === 'pass' ? 'pass' : s.decision === 'edit' ? 'edit' : s.decision === 'reject' ? 'reject' : '';
      return '<button class="item" data-goto="' + it.index + '">' +
        '<span class="n">#' + it.index + '</span>' +
        '<span class="level ' + esc(it.level) + '" style="font-size:11px">' + esc(it.level) + '</span>' +
        '<span class="nm">' + esc(it.source.genericName) + ' × ' + esc([...new Set(it.candidate.genericNames)].join(' / ')) + '</span>' +
        '<span class="st ' + stCls + '">' + st + '</span></button>';
    }).join('');
    document.getElementById('tocList').innerHTML = html;
  }
  function updateProgress() {
    var c = counts();
    var total = report.items.length;
    var remaining = total - c.done;
    var p = document.getElementById('progress');
    p.innerHTML =
      '<span class="stat">已处理 <b>' + c.done + '</b> / ' + total + '</span>' +
      '<span class="stat ok">通过 ' + c.pass + '</span>' +
      '<span class="stat warn">改判 ' + c.edit + '</span>' +
      '<span class="stat bad">拒绝 ' + c.reject + '</span>';
    var rem = document.getElementById('remaining');
    rem.textContent = remaining > 0 ? '未处理 ' + remaining + ' 条' : '全部 ' + total + ' 条已处理';
    rem.className = 'remaining ' + (remaining > 0 ? 'pending' : 'done');
  }
  function groupHtml(details) {
    return details.map(function (group, gi) {
      var pills = group.map(function (p) { return '<span class="pill">' + esc(p.genericName) + (p.form ? ' · ' + esc(p.form) : '') + '</span>'; }).join('');
      return '<div class="group"><b>G' + (gi + 1) + '</b> ' + pills + '</div>';
    }).join('');
  }
  function decisionHtml(it) {
    var s = state[it.index] || {};
    var d = s.decision || '';
    var chip = d === 'pass' ? '<span class="level">已通过</span>' : d === 'edit' ? '<span class="level">待改判</span>' : d === 'reject' ? '<span class="level">已拒绝</span>' : '<span class="muted">未处理</span>';
    var html = '<div class="decision">' + chip +
      '<button data-i="' + it.index + '" data-act="pass">通过</button>' +
      '<button data-i="' + it.index + '" data-act="edit">改判</button>' +
      '<button data-i="' + it.index + '" data-act="reject">拒绝</button>' +
      (d ? '<button data-i="' + it.index + '" data-act="clear">清除</button>' : '') + '</div>';
    if (d === 'edit') {
      html += '<div class="editbox">' +
        '<label>改判级别 <select data-i="' + it.index + '" data-field="level">' +
        LEVELS.map(function (l) { return '<option' + ((s.level || it.level) === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') +
        '</select></label>' +
        '<textarea data-i="' + it.index + '" data-field="note" placeholder="改判说明（药品组/剂型/分级理由）">' + esc(s.note || '') + '</textarea>' +
        '</div>';
    }
    if (d === 'reject') {
      html += '<div class="editbox"><textarea data-i="' + it.index + '" data-field="reason" placeholder="拒绝原因（必填）">' + esc(s.reason || '') + '</textarea></div>';
    }
    return html;
  }
  function render() {
    var filter = document.getElementById('filter').value;
    var html = report.items.map(function (it, idx) {
      if (filter !== 'all' && it.level !== filter) return '';
      var flags = it.flags.map(function (f) { var k = f.split(':')[0]; return '<span class="chip ' + (k === 'VERBATIM_FAILED' ? 'warn' : '') + '" title="' + esc(FLAG_HELP[k] || '') + '">' + esc(k) + '</span>'; }).join('');
      var risky = it.flags.some(function (f) { return /^(routeMismatch|comboCandidateRisk|comboSourceRisk|VERBATIM_FAILED)/.test(f); });
      return '<section class="card ' + (risky ? 'bad' : (it.flags.length ? 'risk' : '')) + '" data-idx="' + it.index + '">' +
        '<div class="row"><span class="idx">#' + it.index + '</span><span class="level ' + esc(it.level) + '">' + esc(it.level) + '</span>' +
        '<span class="pair">' + esc(it.source.genericName) + ' × ' + esc([...new Set(it.candidate.genericNames)].join(' / ')) + '</span></div>' +
        '<blockquote>' + esc(it.quote) + '</blockquote>' +
        (it.quotePrefix ? '<div class="muted">起点前文（可能需补全）：' + esc(it.quotePrefix) + '</div>' : '') +
        '<div class="muted">来源：' + esc(it.source.insertId) + ' · ' + esc(it.source.version || '—') + ' · 段：' + esc(it.source.sectionKey) + '</div>' +
        '<div class="chips">' + flags + '</div>' +
        groupHtml(report.groupDetails[idx]) +
        '<div class="muted">候选剂型：' + esc((it.candidate.forms || []).join(' / ') || '—') + ' · 建议级别：' + esc(it.level) + '</div>' +
        decisionHtml(it) + '</section>';
    }).join('');
    document.getElementById('cards').innerHTML = html;
    updateProgress();
    renderToc();
  }
  document.getElementById('cards').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var i = Number(b.getAttribute('data-i'));
    var act = b.getAttribute('data-act');
    if (act === 'clear') delete state[i];
    else if (act === 'pass') state[i] = { decision: 'pass' };
    else if (act === 'edit') state[i] = { decision: 'edit', level: (state[i] && state[i].level) || report.items.filter(function (x) { return x.index === i; })[0].level, note: (state[i] && state[i].note) || '' };
    else if (act === 'reject') state[i] = { decision: 'reject', reason: (state[i] && state[i].reason) || '' };
    save(); render();
  });
  document.getElementById('cards').addEventListener('input', function (e) {
    var el = e.target;
    var field = el.getAttribute('data-field');
    if (!field) return;
    var i = Number(el.getAttribute('data-i'));
    state[i] = state[i] || { decision: 'edit' };
    state[i][field] = el.value;
    save();
  });
  document.getElementById('filter').addEventListener('change', render);
  document.getElementById('tocToggle').addEventListener('click', function () { setToc(!tocOpen); });
  document.getElementById('tocClose').addEventListener('click', function () { setToc(false); });
  document.getElementById('backdrop').addEventListener('click', function () { setToc(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setToc(false); });
  document.getElementById('tocList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-goto]');
    if (!b) return;
    var i = Number(b.getAttribute('data-goto'));
    setToc(false);
    var card = document.querySelector('section.card[data-idx="' + i + '"]');
    if (!card) {
      document.getElementById('filter').value = 'all';
      render();
      card = document.querySelector('section.card[data-idx="' + i + '"]');
    }
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.classList.add('flash');
      setTimeout(function () { card.classList.remove('flash'); }, 1200);
    }
  });
  document.getElementById('reset').addEventListener('click', function () {
    if (!confirm('清空本机所有签核状态？')) return;
    state = {}; save(); render();
  });
  document.getElementById('export').addEventListener('click', function () {
    var r = document.getElementById('reviewer').value.trim();
    if (!r) { alert('请先填写签核人（姓名/工号）'); return; }
    var decisions = [];
    report.items.forEach(function (it) {
      var s = state[it.index];
      if (!s || !s.decision) return;
      if (s.decision === 'reject' && !String(s.reason || '').trim()) { alert('#' + it.index + ' 拒绝但未填原因'); throw new Error('missing reason'); }
      decisions.push({ index: it.index, decision: s.decision, level: s.level || it.level, note: s.note || '', reason: s.reason || '' });
    });
    if (decisions.length === 0) { alert('还没有任何判定'); return; }
    var out = { schemaVersion: 1, batchId: report.batchId || 'm10-signoff-20', reviewer: r, exportedAt: new Date().toISOString(), total: report.items.length, decisions: decisions };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (report.batchId || 'signoff-20') + '-decisions.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    document.getElementById('hint').textContent = '已导出 ' + decisions.length + ' 条；把文件放到 data/m10-reports/ 或发回对话。';
  });
  setToc(tocOpen);
  render();
})();
</script>
</body>
</html>`
}


main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 签核清单生成失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
