/**
 * M9-T2 · 从 230 行 reviewed PDF 说明书挖相互作用规则候选（只输出候选，不写库）。
 *
 * 用法（cd app）：
 *   pnpm --filter @anxin/api db:rule-candidates -- --out ../../../data/m9-reports
 *
 * 输出：
 *   rule-candidates.jsonl —— 每条候选 {sourceDrugId, quote, candidateDrugIds, level, ...}
 *   rule-candidates.md    —— 人读报告（前 50 条 + 噪声说明 + 签核流程）
 *   rule-candidates-summary.json
 *
 * 纪律：候选必须逐字、分级只是建议；入库前必须人工逐条签核（PRD §7.8.1）。
 */
import '../lib/env.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { and, eq, like } from 'drizzle-orm'
import { INTERACTION_LEVEL_ORDER } from '@anxin/shared'
import { db, client } from '../db/client.js'
import { drugMaster, packageInserts } from '../db/schema.js'
import {
  buildAliasIndex,
  mineCandidates,
  verifyCandidates,
  type MasterDrug,
  type SourceManual,
} from '../services/rules/candidate-mining.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function main(): Promise<number> {
  const outDir = join(repoRoot, arg('--out') ?? join('data', 'm9-reports'))

  const [masters, inserts] = await Promise.all([
    db
      .select({
        id: drugMaster.id,
        genericName: drugMaster.genericName,
        brandName: drugMaster.brandName,
        form: drugMaster.form,
      })
      .from(drugMaster),
    db
      .select({
        insertId: packageInserts.id,
        drugId: packageInserts.drugId,
        genericName: packageInserts.genericName,
        version: packageInserts.version,
        sourceSections: packageInserts.sourceSections,
      })
      .from(packageInserts)
      .where(
        and(
          eq(packageInserts.curationStatus, 'reviewed'),
          like(packageInserts.source, '说明书 PDF%'),
        ),
      ),
  ])

  const aliasIndex = buildAliasIndex(masters as MasterDrug[])
  const manuals: SourceManual[] = inserts.map((r) => ({
    insertId: r.insertId,
    drugId: r.drugId,
    genericName: r.genericName,
    version: r.version,
    sections: r.sourceSections ?? {},
  }))

  const { candidates, stats } = mineCandidates(manuals, aliasIndex)
  const verifyErrors = verifyCandidates(candidates, manuals)

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'rule-candidates.jsonl'), candidates.map((c) => JSON.stringify(c)).join('\n') + '\n')

  const byLevel = candidates.reduce<Record<string, number>>((acc, c) => {
    acc[c.level] = (acc[c.level] ?? 0) + 1
    return acc
  }, {})
  const byPair = new Map<string, number>()
  for (const c of candidates) {
    for (const name of c.candidateGenericNames) {
      const key = [c.sourceGenericName, name].sort().join(' × ')
      byPair.set(key, (byPair.get(key) ?? 0) + 1)
    }
  }
  const topPairs = [...byPair].sort((a, b) => b[1] - a[1]).slice(0, 20)

  const summary = {
    generatedAt: new Date().toISOString(),
    masters: masters.length,
    reviewedPdfManuals: manuals.length,
    stats,
    byLevel,
    fullNameMatches: candidates.filter((c) => c.aliasKind === 'full').length,
    strippedOnlyMatches: candidates.filter((c) => c.aliasKind === 'stripped').length,
    ambiguousMatches: candidates.filter((c) => c.ambiguous).length,
    topPairs,
    verifyErrors,
    note: '候选只做逐字摘录与确定性分级建议；不入库、不写 seed，必须人工逐条签核。',
  }
  writeFileSync(join(outDir, 'rule-candidates-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)

  const md: string[] = []
  md.push('# M9-T2 · 相互作用规则候选池（reviewed PDF 说明书）')
  md.push('')
  md.push(`生成：${summary.generatedAt} · 语料：${manuals.length} 行 reviewed PDF 说明书 · 药名索引：${masters.length} 个 drug_master`)
  md.push('')
  md.push('> 候选只做逐字摘录与确定性分级建议；**不入库、不写 seed**。入库前必须人工逐条确认 quote 逐字、分级、来源与药品 ID。')
  md.push('')
  md.push('## 汇总')
  md.push('')
  md.push(`- 有相互作用段的说明书：**${stats.manualsWithSection}** / ${stats.manuals}；扫描句数 ${stats.sentences}`)
  md.push(`- 候选：**${candidates.length}** 条；跳过无影响句 ${stats.skippedNoEffect}、仅自身成分 ${stats.skippedSelfOnly}、表格行 ${stats.skippedTable}、重复句 ${stats.duplicateQuotes}`)
  md.push(`- 建议分级分布：${Object.entries(byLevel).map(([k, v]) => `${k} ${v}`).join(' / ') || '—'}`)
  md.push(`- 匹配类型：原文全名 ${summary.fullNameMatches} / 归一别名 ${summary.strippedOnlyMatches} / 歧义 ${summary.ambiguousMatches}`)
  md.push(`- 逐字自检错误：**${verifyErrors.length}**（必须 0）`)
  md.push('')
  if (verifyErrors.length > 0) {
    md.push('## ❌ 逐字自检错误')
    md.push('')
    for (const e of verifyErrors.slice(0, 20)) md.push(`- ${e}`)
    md.push('')
  }
  const ranked = [...candidates].sort(
    (a, b) =>
      INTERACTION_LEVEL_ORDER[b.level] - INTERACTION_LEVEL_ORDER[a.level] ||
      (a.aliasKind === 'full' ? 0 : 1) - (b.aliasKind === 'full' ? 0 : 1) ||
      b.quote.length - a.quote.length,
  )
  md.push('## 候选 Top 50（按分级重量 + 原文全名优先）')
  md.push('')
  md.push('| # | 来源药 | 提及药（候选） | 建议 | 匹配 | quote（逐字，截 80 字） |')
  md.push('|---|---|---|---|---|---|')
  ranked.slice(0, 50).forEach((c, i) => {
    const matchKind = c.aliasKind === 'full' ? '全名' : '归一'
    md.push(
      `| ${i + 1} | ${c.sourceGenericName} | ${[...new Set(c.candidateGenericNames)].join(' / ')}${c.ambiguous ? '（歧义）' : ''} | ${c.level} | ${matchKind} | ${c.quote.replace(/\|/g, '｜').slice(0, 80)} |`,
    )
  })
  md.push('')
  md.push('## Top 配对（按候选句数）')
  md.push('')
  for (const [pair, n] of topPairs) md.push(`- ${pair}：${n}`)
  md.push('')
  md.push('## 已知噪声（签核时逐条判断）')
  md.push('')
  md.push('1. **药名归一**：去剂型/盐基只是匹配辅助；「XX 类药物」不会被展开为具体药，候选可能漏掉类别级联用。')
  md.push('2. **剂型/给药途径**：归一别名可能把「红霉素（系统用药）」的语句匹配到「红霉素眼膏」这类局部制剂；`匹配=归一` 的候选必须人工确认剂型与途径是否适用。')
  md.push('3. **同通用名多产品**：同一通用名有多个 `drug_master` 行时，候选列出多 ID（`ambiguous=true`）；当前规则模型 flat `drugIds` 需全命中，入库前要决定按哪些具体行建规则。')
  md.push('4. **分级词表**：`注意` 统一归入 `需监测`（避免低报）；`禁忌/慎用` 仍有语境误判可能，必须人工确认。')
  md.push('5. **只覆盖 reviewed PDF 行**：DXY 15 行相互作用段缺失（M8 已登记），未纳入；表格行（管道残留）本轮跳过。')
  md.push('6. **引用限制**：候选是单句摘录，入库 note 需截自该 quote，quote 需可回溯 sourceSections；不得改写。')
  md.push('')
  md.push('## 签核流程（人工）')
  md.push('')
  md.push('1. 逐条确认：quote 与原文一致、分级合理、来源药/提及药 ID 正确（同通用名多产品需选定具体行）；')
  md.push('2. 通过的条目按 `rule-curation` 守门格式写入 `seed-interaction-rules.json`（status=curated + sourceType/sourceRef/quote/reviewedBy）；')
  md.push('3. `db:seed-interaction-rules --check` 必须全过；任何 note 非 quote 子串、来源行非 reviewed 的条目会被拒绝。')
  writeFileSync(join(outDir, 'rule-candidates.md'), md.join('\n') + '\n')

  console.log(`\n✅ 候选挖掘完成`)
  console.log(`   语料：${manuals.length} 行 reviewed PDF（有相互作用段 ${stats.manualsWithSection}）`)
  console.log(`   扫描句数 ${stats.sentences}；候选 ${candidates.length} 条；逐字自检错误 ${verifyErrors.length}`)
  console.log(`   分级：${Object.entries(byLevel).map(([k, v]) => `${k} ${v}`).join(' / ') || '—'}`)
  console.log(`   输出：${join(outDir, 'rule-candidates.jsonl')} / rule-candidates.md / rule-candidates-summary.json`)
  return verifyErrors.length === 0 ? 0 : 1
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 候选挖掘失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
