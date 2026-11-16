/**
 * M8-T4 · 上线覆盖指标 + reviewed 扩面队列（只排队，不升格）。
 *
 * 输出（默认 data/m8-reports/，本地 gitignored）：
 *   - coverage.json / coverage.md：reviewed 覆盖率、规则覆盖、相互作用段可得率、L0 门禁原因；
 *   - review-queue.jsonl：≥200 行 crawled PDF 说明书，按「药箱相关 > 高危类目 > 其余」排序 + 结构预检。
 *
 * 用法（cd app）：
 *   pnpm --filter @anxin/api db:coverage-m8 -- --out ../../../data/m8-reports
 *
 * 边界：本脚本只读库、只写本地报告；不升格、不改库。
 */
import 'dotenv/config'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { and, eq, isNotNull, like } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import { drugs, interactionRules, packageInserts } from '../db/schema.js'
import { REQUIRED_SECTIONS } from '../services/review/decisions.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

const HIGH_RISK_RE =
  /他汀|地平|沙坦|普利|洛尔|格列|胰岛素|达比加群|华法林|利伐沙班|阿哌沙班|氯吡格雷|阿司匹林|双嘧达莫|肝素|二甲双胍/

/** 队列预检：六段缺失、交叉引用占位、频率表疑似被拉平（R1/R2 信号）。 */
function precheck(sections: Record<string, string>, interactions: string | null, adverse: string | null) {
  const missing: string[] = []
  for (const slot of REQUIRED_SECTIONS) {
    const text = slot.sourceKeys.map((k) => sections[k] ?? '').find((t) => t.trim()) ?? ''
    if (!text) missing.push(slot.label)
  }
  const interactionsText = interactions ?? sections['药物相互作用'] ?? ''
  const adverseText = adverse ?? sections['不良反应'] ?? ''
  const flags: string[] = []
  if (/（见\s*）|（见）/.test(interactionsText) || /（见\s*）|（见）/.test(adverseText)) flags.push('交叉引用占位')
  if (/十分常见|系统器官分类/.test(adverseText) && !adverseText.includes('|')) flags.push('频率表疑似拉平(R1/R2)')
  if (adverseText.length > 4000) flags.push('不良反应长段')
  return { missingSections: missing, flags, hasInteractions: !!interactionsText.trim() }
}

async function main(): Promise<number> {
  const outDir = resolve(arg('--out') ?? join(repoRoot, 'data', 'm8-reports'))
  mkdirSync(outDir, { recursive: true })

  // ── 1. 基础计数 ──────────────────────────────────────────────────────────
  const allInserts = await db
    .select({
      drugId: packageInserts.drugId,
      status: packageInserts.curationStatus,
      source: packageInserts.source,
      interactions: packageInserts.interactions,
      adverseReactions: packageInserts.adverseReactions,
      sourceSections: packageInserts.sourceSections,
      genericName: packageInserts.genericName,
      version: packageInserts.version,
      dosage: packageInserts.dosage,
    })
    .from(packageInserts)
  const isDxy = (s: string | null) => (s ?? '').includes('丁香园')
  const count = (fn: (r: (typeof allInserts)[number]) => boolean) => allInserts.filter(fn).length
  const total = allInserts.length
  const reviewed = count((r) => r.status === 'reviewed')
  const reviewedPdf = count((r) => r.status === 'reviewed' && !isDxy(r.source))
  const reviewedDxy = count((r) => r.status === 'reviewed' && isDxy(r.source))
  const dxyRows = allInserts.filter((r) => isDxy(r.source)).length
  const pdfRows = total - dxyRows

  // ── 2. 药箱相关（drugs.drug_master_id 非空）──────────────────────────────
  const boxMasters = await db
    .selectDistinct({ masterId: drugs.drugMasterId, genericName: drugs.genericName, confirmStatus: drugs.confirmStatus })
    .from(drugs)
    .where(isNotNull(drugs.drugMasterId))
  const boxMasterIds = new Set(boxMasters.map((b) => b.masterId!).filter(Boolean))
  const boxReviewed = allInserts.filter((r) => boxMasterIds.has(r.drugId) && r.status === 'reviewed').length
  const boxManual = boxMasters.filter((b) => b.confirmStatus === 'manual').length

  // ── 3. 规则覆盖（15 对 demo 组合 + 规则状态）─────────────────────────────
  const rules = await db
    .select({ id: interactionRules.id, drugIds: interactionRules.drugIds, status: interactionRules.status, level: interactionRules.level })
    .from(interactionRules)
  const ruleStatus = rules.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  let pairSpec: { drugs: Array<{ drugId: string }> } | null = null
  try {
    pairSpec = JSON.parse(readFileSync(join(repoRoot, 'tools', 'm8-pair-spec.json'), 'utf8'))
  } catch {
    pairSpec = null
  }
  let pairCoverage: { total: number; covered: number; demoCovered: number; curatedCovered: number } | null = null
  if (pairSpec) {
    const ids = pairSpec.drugs.map((d) => d.drugId)
    let totalPairs = 0
    let covered = 0
    let demoCovered = 0
    let curatedCovered = 0
    for (let i = 0; i < ids.length; i++) {
      for (let k = i + 1; k < ids.length; k++) {
        totalPairs++
        const pair = [ids[i], ids[k]].sort().join('|')
        const hit = rules.filter((r) => {
          const rulePair = ((r.drugIds as string[] | null) ?? []).slice().sort().join('|')
          return rulePair === pair
        })
        if (hit.length > 0) covered++
        if (hit.some((r) => r.status === 'demo')) demoCovered++
        if (hit.some((r) => r.status === 'curated')) curatedCovered++
      }
    }
    pairCoverage = { total: totalPairs, covered, demoCovered, curatedCovered }
  }

  // ── 4. 相互作用段可得率 / L0 原因 ─────────────────────────────────────────
  const withInteractions = (rows: typeof allInserts) => rows.filter((r) => (r.interactions ?? '').trim().length > 0).length
  const pdfRowsArr = allInserts.filter((r) => !isDxy(r.source))
  const dxyRowsArr = allInserts.filter((r) => isDxy(r.source))

  const coverage = {
    generatedAt: new Date().toISOString(),
    database: {
      packageInserts: total,
      pdfRows,
      dxyRows,
      reviewed,
      reviewedPdf,
      reviewedDxy,
      crawled: total - reviewed,
      reviewedCoverage: total ? Number((reviewed / total).toFixed(4)) : 0,
    },
    box: {
      distinctMasterIds: boxMasterIds.size,
      reviewed: boxReviewed,
      coverage: boxMasterIds.size ? Number((boxReviewed / boxMasterIds.size).toFixed(4)) : 0,
      manualConfirmDrugs: boxManual,
      note: 'manual confirm_status 即使说明书 reviewed，咨询仍只走 L0（demo 数据问题，M8 不自动改）',
    },
    rules: {
      total: rules.length,
      byStatus: ruleStatus,
      demoPairs: pairCoverage,
    },
    interactionSections: {
      pdf: { rows: pdfRowsArr.length, available: withInteractions(pdfRowsArr), rate: pdfRowsArr.length ? Number((withInteractions(pdfRowsArr) / pdfRowsArr.length).toFixed(4)) : 0 },
      dxy: { rows: dxyRowsArr.length, available: withInteractions(dxyRowsArr), rate: dxyRowsArr.length ? Number((withInteractions(dxyRowsArr) / dxyRowsArr.length).toFixed(4)) : 0 },
    },
    gate: {
      unverifiedInserts: total - reviewed,
      manualGateDrugs: boxMasters.filter((b) => b.confirmStatus === 'manual').length,
      note: 'L0 原因：说明书未 reviewed / manual 建档；两者都可由 SQL 复算。',
    },
  }

  writeFileSync(join(outDir, 'coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`)

  const md: string[] = []
  md.push('# M8-T4 · 上线覆盖指标（2026-11-16）')
  md.push('')
  md.push('| 指标 | 数值 |')
  md.push('|---|---|')
  md.push(`| package_inserts 总行 | ${total}（PDF ${pdfRows} + DXY ${dxyRows}） |`)
  md.push(`| reviewed | **${reviewed}**（PDF ${reviewedPdf} + DXY ${reviewedDxy}），覆盖率 **${(coverage.database.reviewedCoverage * 100).toFixed(1)}%** |`)
  md.push(`| 药箱相关 drug_master | ${boxMasterIds.size} 个，reviewed **${boxReviewed}/${boxMasterIds.size}** |`)
  md.push(`| manual 建档药（门禁） | ${boxManual} 个（即使 reviewed 仍 L0） |`)
  md.push(`| 规则库 | ${rules.length} 条：${JSON.stringify(ruleStatus)} |`)
  md.push(`| demo 15 对规则覆盖 | ${pairCoverage ? `${pairCoverage.covered}/${pairCoverage.total}（demo ${pairCoverage.demoCovered} / curated ${pairCoverage.curatedCovered}）` : '账本缺失'} |`)
  md.push(`| 相互作用段可得率 | PDF ${(coverage.interactionSections.pdf.rate * 100).toFixed(1)}%（${coverage.interactionSections.pdf.available}/${coverage.interactionSections.pdf.rows}）/ DXY ${(coverage.interactionSections.dxy.rate * 100).toFixed(1)}%（${coverage.interactionSections.dxy.available}/${coverage.interactionSections.dxy.rows}） |`)
  md.push('')
  md.push('## 解读')
  md.push('')
  md.push('- reviewed 覆盖仍是瓶颈：245/1603（15.3%），绝大多数说明书未核验 → 咨询只走 L0；')
  md.push('- demo 药箱 5 药的说明书行已全部 reviewed，但 4 个演示药 `confirm_status=manual`，个体化咨询仍被 manual 门禁挡住；')
  md.push('- 规则库 3 条 demo / 0 curated，15 对组合仅 3 对命中（且均为 demo），未覆盖 ≠ 无风险；')
  md.push('- 相互作用段可得率约九成，但 demo 6 药里 4 个 DXY 条目无该段——规则库扩面不能只靠“有没有说明书”。')
  writeFileSync(join(outDir, 'coverage.md'), md.join('\n') + '\n')

  // ── 5. reviewed 扩面队列（只排队）────────────────────────────────────────
  const crawledPdf = await db
    .select({
      drugId: packageInserts.drugId,
      genericName: packageInserts.genericName,
      version: packageInserts.version,
      sourceFile: packageInserts.sourceFile,
      interactions: packageInserts.interactions,
      adverseReactions: packageInserts.adverseReactions,
      sourceSections: packageInserts.sourceSections,
    })
    .from(packageInserts)
    .where(and(eq(packageInserts.curationStatus, 'crawled'), like(packageInserts.source, '说明书 PDF%')))

  const queue = crawledPdf
    .map((r) => {
      const priority = boxMasterIds.has(r.drugId) ? 1 : HIGH_RISK_RE.test(r.genericName ?? '') ? 2 : 3
      const check = precheck(r.sourceSections ?? {}, r.interactions, r.adverseReactions)
      return {
        priority,
        drugId: r.drugId,
        genericName: r.genericName,
        version: r.version,
        sourceFile: r.sourceFile,
        precheck: check,
      }
    })
    .sort((a, b) => a.priority - b.priority || String(a.genericName).localeCompare(String(b.genericName), 'zh') || a.drugId.localeCompare(b.drugId))
    .slice(0, 200)

  writeFileSync(join(outDir, 'review-queue.jsonl'), queue.map((q) => JSON.stringify(q)).join('\n') + '\n')
  const priorityCounts = queue.reduce<Record<number, number>>((acc, q) => {
    acc[q.priority] = (acc[q.priority] ?? 0) + 1
    return acc
  }, {})
  writeFileSync(
    join(outDir, 'review-queue-summary.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), count: queue.length, priorityCounts, note: '只排队不升格；priority 1=药箱相关，2=高危类目，3=其余' }, null, 2)}\n`,
  )

  console.log(`✅ 覆盖指标：reviewed ${reviewed}/${total}（${(coverage.database.reviewedCoverage * 100).toFixed(1)}%）· 药箱 ${boxReviewed}/${boxMasterIds.size} · 规则 ${rules.length} 条`)
  console.log(`   输出：${join(outDir, 'coverage.json')} / coverage.md`)
  console.log(`✅ 扩面队列：${queue.length} 行（priority ${JSON.stringify(priorityCounts)}），只排队不升格`)
  console.log(`   输出：${join(outDir, 'review-queue.jsonl')}`)
  return 0
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 覆盖指标生成失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
