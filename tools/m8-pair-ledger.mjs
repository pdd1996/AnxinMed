#!/usr/bin/env node
/**
 * M8-T2 · demo 组合账本（15 对）——只读本地 DXY 草稿，产出「哪对有没有合格来源」的判决。
 *
 * 用法：
 *   node tools/m8-pair-ledger.mjs --drafts data/crawled --out data/m8-reports
 *
 * 输入：
 *   - tools/m8-pair-spec.json：6 药 + 别名 + 现有演示规则映射 + 判据词表；
 *   - data/crawled/<drugId>.json：爬虫草稿（本地，不入库；含 sections 原段）。
 *
 * 输出（本地，gitignored）：
 *   - pairs.jsonl：逐对结论（quote-risk / quote-no-effect / no-section / no-mention）；
 *   - pairs-summary.md：人读摘要 + 每对的一句话结论；
 *   - pairs-summary.json：机器读汇总。
 *
 * 边界：本脚本只做**段名/药名子串 + 句级判据**的机械核对，不生成规则、不改 seed。
 * quote-risk 只是候选，入库仍须过 rule-curation 守门并由人工签名。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback
}

const draftsDir = resolve(arg('--drafts', 'data/crawled'))
const outDir = resolve(arg('--out', 'data/m8-reports'))
const specPath = resolve(arg('--spec', 'tools/m8-pair-spec.json'))

const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const sectionKey = spec.sectionKey ?? '药物相互作用'
const requiredKeys = ['noEffectMarkers', 'riskMarkers']

for (const key of requiredKeys) {
  if (!Array.isArray(spec[key]) || spec[key].length === 0) {
    console.error(`❌ spec 缺少 ${key}`)
    process.exit(1)
  }
}

/** 取一句话（按中文句号/分号/换行切；保留标点便于 quote 原样）。 */
function splitSentences(text) {
  const parts = String(text ?? '').match(/[^。；;！？!?\n]+[。；;！？!?]?/g) ?? []
  return parts.map((s) => s.trim()).filter(Boolean)
}

function classifySentence(sentence) {
  const hitNoEffect = spec.noEffectMarkers.filter((m) => sentence.includes(m))
  const hitRisk = spec.riskMarkers.filter((m) => sentence.includes(m))
  if (hitNoEffect.length > 0 && hitRisk.length === 0) return { kind: 'no-effect', hitNoEffect, hitRisk }
  // 同时出现「无影响」+「注意」这类混合句：按 no-effect 处理但保留双方标记，交给人工复核
  if (hitNoEffect.length > 0 && hitRisk.length > 0) return { kind: 'mixed', hitNoEffect, hitRisk }
  if (hitRisk.length > 0) return { kind: 'risk', hitNoEffect, hitRisk }
  return { kind: 'unclassified', hitNoEffect, hitRisk }
}

/** 按 PRD 四级做确定性建议；最终由人工签名。 */
function suggestLevel(sentence) {
  if (/禁止|禁用/.test(sentence)) return '禁忌'
  if (/慎用|不宜|避免/.test(sentence)) return '慎用'
  if (/监测|注意|谨慎/.test(sentence)) return '需监测'
  return '注意'
}

function collectMentions(fromDrug, toDrug, sectionText) {
  if (!sectionText) return []
  const aliases = toDrug.aliases ?? []
  const out = []
  for (const sentence of splitSentences(sectionText)) {
    const hit = aliases.filter((a) => sentence.includes(a))
    if (hit.length === 0) continue
    const cls = classifySentence(sentence)
    out.push({
      fromDrugId: fromDrug.drugId,
      toDrugId: toDrug.drugId,
      sentence,
      classification: cls.kind,
      matchedAliases: hit,
      markers: { noEffect: cls.hitNoEffect, risk: cls.hitRisk },
      suggestedLevel: cls.kind === 'risk' ? suggestLevel(sentence) : null,
    })
  }
  return out
}

function readDraft(drugId) {
  const path = join(draftsDir, `${drugId}.json`)
  if (!existsSync(path)) {
    throw new Error(`缺少草稿：${path}（data/crawled 为本地目录，可能未同步）`)
  }
  const draft = JSON.parse(readFileSync(path, 'utf8'))
  return {
    drugId,
    version: draft.version ?? null,
    sourceUrl: draft.sourceUrl ?? null,
    sections: draft.sections ?? {},
  }
}

const drugs = spec.drugs.map((d) => ({ ...d, draft: readDraft(d.drugId) }))
const rows = []
const pairKeys = new Set()

for (let i = 0; i < drugs.length; i++) {
  for (let k = i + 1; k < drugs.length; k++) {
    const a = drugs[i]
    const b = drugs[k]
    const pairKey = [a.drugId, b.drugId].sort().join('|')
    if (pairKeys.has(pairKey)) throw new Error(`重复组合：${pairKey}`)
    pairKeys.add(pairKey)

    const secA = a.draft.sections[sectionKey] ?? ''
    const secB = b.draft.sections[sectionKey] ?? ''
    const mentions = [
      ...collectMentions(a, b, secA),
      ...collectMentions(b, a, secB),
    ]

    let verdict
    if (!secA.trim() && !secB.trim()) verdict = 'no-section'
    else if (mentions.length === 0) verdict = 'no-mention'
    else if (mentions.some((m) => m.classification === 'risk')) verdict = 'quote-risk'
    else if (mentions.some((m) => m.classification === 'mixed')) verdict = 'quote-mixed'
    else verdict = 'quote-no-effect'

    const demoRuleIds = (a.demoRuleIds ?? []).filter((id) => (b.demoRuleIds ?? []).includes(id))
    const demoNotes = demoRuleIds.map((id) => ({ id, note: spec.demoNotes?.[id] ?? '' }))

    rows.push({
      pairKey,
      drugs: [
        { drugId: a.drugId, genericName: a.genericName, hasSection: !!secA.trim(), sectionChars: secA.length },
        { drugId: b.drugId, genericName: b.genericName, hasSection: !!secB.trim(), sectionChars: secB.length },
      ],
      verdict,
      demoRuleIds,
      demoNotes,
      mentions,
    })
  }
}

const counts = rows.reduce((acc, r) => {
  acc[r.verdict] = (acc[r.verdict] ?? 0) + 1
  return acc
}, {})
const summary = {
  generatedAt: new Date().toISOString(),
  source: { draftsDir, sectionKey, spec: specPath },
  totalPairs: rows.length,
  verdictCounts: counts,
  curatedCandidates: rows
    .filter((r) => r.verdict === 'quote-risk')
    .reduce((acc, r) => acc.concat(r.mentions.filter((m) => m.classification === 'risk').map((m) => ({ pairKey: r.pairKey, ...m }))), []),
  demoRulesChecked: rows.flatMap((r) => r.demoRuleIds),
  note: '本账本只做机械核对；quote-risk 仍需过 rule-curation 守门 + 人工签名才能入库。',
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'pairs.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
writeFileSync(join(outDir, 'pairs-summary.json'), JSON.stringify(summary, null, 2))

const lines = []
lines.push('# M8-T2 · demo 组合账本（15 对）')
lines.push('')
lines.push(`生成时间：${summary.generatedAt}`)
lines.push(`输入：${draftsDir}（本地，不入库）；判据：\`${sectionKey}\` 段 + 句级风险/无影响词表`)
lines.push('')
lines.push('| 结论 | 对数 |')
lines.push('|---|---|')
for (const [k, v] of Object.entries(counts)) lines.push(`| ${k} | ${v} |`)
lines.push('')
lines.push('## 逐对结论')
lines.push('')
lines.push('| 组合 | 有相互作用段 | 结论 | 现有演示规则 | 候选句 |')
lines.push('|---|---|---|---|---|')
for (const r of rows) {
  const names = r.drugs.map((d) => d.genericName).join(' × ')
  const sec = r.drugs.map((d) => (d.hasSection ? `${d.sectionChars} 字` : '无')).join(' / ')
  const quote = r.mentions[0]?.sentence ? `「${r.mentions[0].sentence.slice(0, 60)}…」` : '—'
  lines.push(`| ${names} | ${sec} | ${r.verdict} | ${r.demoRuleIds.join('、') || '—'} | ${quote} |`)
}
lines.push('')
lines.push('## 结论')
lines.push('')
const risk = summary.curatedCandidates.length
lines.push(`- 可进入 curated 候选的逐字风险句：**${risk}** 条`)
lines.push('- 无相互作用段 / 段内未提及的组合一律不建规则（PRD §7.8.1 来源限定，不用注意事项段顶替）')
lines.push('- 现有 3 条演示规则保留 `status=demo`，不改写、不升格；账本 `pairs.jsonl` 可复核')
writeFileSync(join(outDir, 'pairs-summary.md'), lines.join('\n') + '\n')

console.log(`✅ 账本已生成：${rows.length} 对`)
console.log(`   结论分布：${JSON.stringify(counts)}`)
console.log(`   curated 候选：${summary.curatedCandidates.length} 条`)
console.log(`   输出：${join(outDir, 'pairs.jsonl')} / pairs-summary.md / pairs-summary.json`)
