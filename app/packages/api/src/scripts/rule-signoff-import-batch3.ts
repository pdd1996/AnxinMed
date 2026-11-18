/**
 * M12 · batch3 签核结果 → seed 草案（dry-run，不写库、不改 seed）。
 *
 * 输入：
 *   - data/review-manual/signoff-batch3-final-decisions.json —— 签核页导出的 decisions
 *     { reviewer, exportedAt, decisions: [{ index, decision: 'pass'|'edit'|'reject', level, note, reason }] }
 *   - data/m11-reports/signoff-batch3.final.json —— 工程预审修正版签核包（15 条）
 * 输出：
 *   - data/m11-reports/seed-additions-batch3.json —— 守门通过的 curated 规则草案（可直接合并进 seed 的形态）
 *   - data/m11-reports/import-report-batch3.md   —— 人读报告（通过/失败/拒绝/批次错误）
 *
 * 与 batch2 importer 的差异：
 *   - 规则 ID 直接用终版签核包里的 `m12-b3-cand-XX`（命名空间已避让），并显式检查与库内现有 ID 冲突；
 *   - 不再做任何"按索引硬编码"的范围/引文修正——这些已在 `signoff-batch3.final.json` 完成；
 *   - 只认终版签核包（校验 batchId/ID 前缀），避免把生成版误当修正版导入。
 *
 * 用法（cd app）：
 *   pnpm --filter @anxin/api db:rule-signoff-import-batch3 -- --decisions data/review-manual/xxx.json
 *
 * 边界：**dry-run only**；不写 seed、不改 DB。实际入库需人工确认报告后另走 seed 合并 + `db:seed-interaction-rules --check/--apply`。
 */
import '../lib/env.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inArray } from 'drizzle-orm'
import { db, client } from '../db/client.js'
import { drugMaster, interactionRules, packageInserts } from '../db/schema.js'
import {
  INTERACTION_SECTION_KEYS,
  validateRules,
  type ManualSnapshot,
  type RuleCurationContext,
  type RuleCurationInput,
} from '../services/rules/rule-curation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')

const LEVELS = ['禁忌', '慎用', '需监测', '注意'] as const
const ID_PREFIX = 'm12-b3-cand-'

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}
function resolvePath(p: string): string {
  return isAbsolute(p) ? p : join(repoRoot, p)
}

interface Decision {
  index: number
  decision: 'pass' | 'edit' | 'reject' | ''
  level?: string
  note?: string
  reason?: string
}

interface DecisionsFile {
  reviewer: string
  exportedAt?: string
  decisions: Decision[]
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

interface FinalReport {
  batchId: string
  items: FinalItem[]
}

async function main(): Promise<number> {
  const decisionsPath = resolvePath(arg('--decisions') ?? join('data', 'review-manual', 'signoff-batch3-final-decisions.json'))
  const signoffPath = resolvePath(arg('--signoff') ?? join('data', 'm11-reports', 'signoff-batch3.final.json'))
  const outDir = resolvePath(arg('--out') ?? join('data', 'm11-reports'))
  mkdirSync(outDir, { recursive: true })

  if (!existsSync(decisionsPath)) {
    console.error(`❌ decisions 文件不存在：${decisionsPath}`)
    console.error('   请先在 data/m11-reports/signoff-batch3.final.html 完成判定并「导出 decisions JSON」，再用 --decisions 指定。')
    return 1
  }
  if (!existsSync(signoffPath)) {
    console.error(`❌ 签核包不存在：${signoffPath}`)
    return 1
  }

  const decisions = JSON.parse(readFileSync(decisionsPath, 'utf8')) as DecisionsFile
  const signoff = JSON.parse(readFileSync(signoffPath, 'utf8')) as FinalReport & { batchLabel?: string }

  const inputErrors: string[] = []
  if (!decisions.reviewer?.trim()) inputErrors.push('decisions 缺少签核人 reviewer（签核页导出时必填）')
  if (!decisions.decisions?.length) inputErrors.push('decisions 为空（至少需要 1 条判定）')
  if (signoff.batchId !== 'signoff-batch3.final') inputErrors.push(`--signoff 不是 batch3 工程预审修正版（batchId=${signoff.batchId}）`)
  for (const it of signoff.items ?? []) {
    if (!it.proposedRule?.id?.startsWith(ID_PREFIX)) inputErrors.push(`签核包规则 ID 前缀异常：${it.proposedRule?.id}`)
  }
  if (inputErrors.length > 0) {
    console.error('❌ 输入校验失败：')
    inputErrors.forEach((e) => console.error(`- ${e}`))
    return 1
  }

  const itemByIndex = new Map(signoff.items.map((it) => [it.index, it]))
  const dmap = new Map<number, Decision>()
  const dupIndex: number[] = []
  for (const d of decisions.decisions) {
    if (!Number.isInteger(d.index) || !itemByIndex.has(d.index)) {
      console.error(`❌ 判定引用了不存在的签核项 index=${d.index}`)
      return 1
    }
    if (dmap.has(d.index)) dupIndex.push(d.index)
    dmap.set(d.index, d)
    if (!['pass', 'edit', 'reject', ''].includes(d.decision)) {
      console.error(`❌ #${d.index} 判定非法：${d.decision}（只允许 pass / edit / reject；空=未判定）`)
      return 1
    }
    if (d.decision === 'edit' && d.level && !(LEVELS as readonly string[]).includes(d.level)) {
      console.error(`❌ #${d.index} 改判级别非法：${d.level}`)
      return 1
    }
  }
  if (dupIndex.length > 0) {
    console.error(`❌ 同一签核项出现多条判定：${dupIndex.join(', ')}`)
    return 1
  }

  // ── 取库内上下文（与 seed 守门同源）────────────────────────────────────────
  const masterRows = await db.select({ id: drugMaster.id, genericName: drugMaster.genericName, form: drugMaster.form }).from(drugMaster)
  const masterById = new Map(masterRows.map((m) => [m.id, m]))

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
  const existingIds = new Set(existingRows.map((r) => r.id))
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

  // ── 组装规则草案 ────────────────────────────────────────────────────────────
  const rules: RuleCurationInput[] = []
  const rejected: Array<{ index: number; pair: string; reason: string }> = []
  const skipped: Array<{ index: number; reason: string }> = []
  const idConflicts: string[] = []
  const engineeringNotes: string[] = []
  const reviewedAt = decisions.exportedAt?.trim() || new Date().toISOString()

  for (const it of signoff.items) {
    const d = dmap.get(it.index)
    const pair = `${it.source.genericName} × ${[...new Set(it.groups.map((g) => masterById.get(g[0])?.genericName ?? g[0]))].join(' / ')}`
    if (!d || !d.decision) {
      skipped.push({ index: it.index, reason: '未判定（pending）' })
      continue
    }
    if (d.decision === 'reject') {
      rejected.push({ index: it.index, pair, reason: d.reason?.trim() || '（未填原因）' })
      continue
    }
    const level = (d.decision === 'edit' && d.level ? d.level : it.level) as RuleCurationInput['level']
    const groups = (it.proposedRule.drugGroups ?? it.groups).map((g) => [...g])
    const drugIds = [...new Set(groups.flat())]
    if (existingIds.has(it.proposedRule.id)) {
      const msg = `规则 ID 冲突：${it.proposedRule.id} 已存在于库内（继续入库会 upsert 覆盖旧规则），请先换 ID 或停用旧规则`
      engineeringNotes.push(`#${it.index} ${msg}`)
      idConflicts.push(`#${it.index} ${msg}`)
      continue
    }
    rules.push({
      id: it.proposedRule.id,
      drugIds,
      drugGroups: groups,
      level,
      note: it.quote,
      source: `${it.source.genericName}说明书·${it.source.sectionKey}（M12 batch3 人工签核）`,
      status: 'curated',
      sourceType: 'manual-interaction',
      sourceRef: it.proposedRule.sourceRef,
      quote: it.quote,
      reviewedBy: decisions.reviewer.trim(),
      reviewedAt,
    })
  }

  // ── 守门（与 seed --check 同源）────────────────────────────────────────────
  const batch = validateRules(rules, ctx)
  const accepted: RuleCurationInput[] = []
  const failed: Array<{ rule: RuleCurationInput; errors: string[]; warnings: string[] }> = []
  for (const rule of rules) {
    const res = batch.perRule[rule.id] ?? { errors: [], warnings: [] }
    if (res.errors.length === 0) accepted.push(rule)
    else failed.push({ rule, errors: res.errors, warnings: res.warnings })
  }
  const batchErrors = batch.errors.filter((e) => !Object.values(batch.perRule).some((r) => r.errors.includes(e)))
  batchErrors.push(...idConflicts)

  // 补充：来源段白名单与 reviewed 状态由 validateRule 覆盖；这里额外显式核对 sourceRef 段名，便于报告可读。
  for (const rule of accepted) {
    try {
      const ref = JSON.parse(rule.sourceRef ?? '') as { sectionKey?: string }
      if (!ref.sectionKey || !(INTERACTION_SECTION_KEYS as readonly string[]).includes(ref.sectionKey)) {
        batchErrors.push(`规则 ${rule.id}：sourceRef.sectionKey 不在允许段（${ref.sectionKey ?? '缺失'}）`)
      }
    } catch {
      batchErrors.push(`规则 ${rule.id}：sourceRef 不是合法 JSON`)
    }
  }
  const finalAccepted = accepted.filter((r) => !batchErrors.some((e) => e.startsWith(`规则 ${r.id}：`)))

  writeFileSync(join(outDir, 'seed-additions-batch3.json'), `${JSON.stringify(finalAccepted, null, 2)}\n`)

  const passedPass = [...dmap.values()].filter((d) => d.decision === 'pass').length
  const passedEdit = [...dmap.values()].filter((d) => d.decision === 'edit').length
  const rejectedCount = [...dmap.values()].filter((d) => d.decision === 'reject').length

  const md: string[] = []
  md.push('# M12 · batch3 签核结果导入 dry-run')
  md.push('')
  md.push(`- 输入：\`${decisionsPath.replace(repoRoot + '\\', '')}\``)
  md.push(`- 签核包：\`${signoffPath.replace(repoRoot + '\\', '')}\`（${signoff.batchLabel ?? ''}）`)
  md.push(`- 签核人：**${decisions.reviewer.trim()}** · 导出时间：${decisions.exportedAt ?? '—'}`)
  md.push(`- 判定：pass ${passedPass} / edit ${passedEdit} / reject ${rejectedCount} / pending ${skipped.length}`)
  md.push('')
  md.push(`**规则草案 ${rules.length} 条 → 守门通过 ${finalAccepted.length} / 未通过 ${failed.length} / 拒绝 ${rejected.length} / 批次错误 ${batchErrors.length}**`)
  md.push('')
  md.push('| id | 级别 | 药对（概念组） | quote（截 80） |')
  md.push('|---|---|---|---|')
  for (const r of finalAccepted) {
    const pair = (r.drugGroups ?? []).map((g) => `${masterById.get(g[0])?.genericName ?? g[0]} 等 ${g.length} 个`).join(' × ')
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
  if (rejected.length > 0) {
    md.push('## 🚫 签核拒绝')
    md.push('')
    rejected.forEach((r) => md.push(`- #${r.index} ${r.pair}：${r.reason}`))
    md.push('')
  }
  if (idConflicts.length > 0) {
    md.push('## ❌ 规则 ID 冲突（阻断入库）')
    md.push('')
    idConflicts.forEach((c) => md.push(`- ${c}`))
    md.push('')
  }
  if (skipped.length > 0) {
    md.push('## ⏳ 未判定（不计入本次入库）')
    md.push('')
    skipped.forEach((s) => md.push(`- #${s.index}：${s.reason}`))
    md.push('')
  }
  if (engineeringNotes.length > 0) {
    md.push('## 工程备注')
    md.push('')
    engineeringNotes.forEach((n) => md.push(`- ${n}`))
    md.push('')
  }
  md.push('## 说明')
  md.push('')
  md.push('- 本脚本只做 **dry-run**：不写 `seed-interaction-rules.json`、不改 DB；')
  md.push('- 守门与 `db:seed-interaction-rules --check` 同源（`validateRules`）：药品 ID/概念组结构/来源段/reviewed/逐字 quote/同药对重复；')
  md.push('- 下一步：人工确认本报告 → 把 `seed-additions-batch3.json` 合并进 seed（补 `reviewedBy/reviewedAt`）→ `--check` → `--apply` → `db:audit` + 覆盖报告复跑。')
  writeFileSync(join(outDir, 'import-report-batch3.md'), md.join('\n') + '\n')

  console.log(
    `\n✅ batch3 dry-run：草案 ${rules.length}；通过 ${finalAccepted.length}；失败 ${failed.length}；拒绝 ${rejected.length}；批次错误 ${batchErrors.length}；未判定 ${skipped.length}`,
  )
  if (failed.length > 0) {
    console.log('❌ 守门失败条目：')
    failed.forEach((f) => console.log(`- ${f.rule.id}: ${f.errors.join('；')}`))
  }
  if (batchErrors.length > 0) batchErrors.forEach((e) => console.log(`- 批次错误：${e}`))
  console.log(`   输出：${join(outDir, 'seed-additions-batch3.json')} / import-report-batch3.md`)
  return failed.length === 0 && batchErrors.length === 0 ? 0 : 1
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ batch3 导入 dry-run 失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
