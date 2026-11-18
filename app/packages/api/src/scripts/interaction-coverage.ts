/**
 * M12 · 相互作用规则覆盖评估（真实用药组合 × 现有规则库）——只读报告。
 *
 * 输入：
 *   - 组合清单：data/m12-reports/coverage-spec.json（本地；按真实世界老年慢病场景构造，非真实患者数据）
 *   - 本地库：drug_master / package_inserts / interaction_rules / users / drugs / plans
 *   - M9 候选池：data/m9-reports/rule-candidates.jsonl（reviewed PDF 逐字候选，仅作证据，不入库）
 * 输出（默认 data/m12-reports/）：
 *   - interaction-coverage.json / interaction-coverage.md
 *
 * 判据（组合内每一对药）：
 *   COVERED            现有规则命中（区分 curated / demo）
 *   ID_GAP             规则概念对存在，但用户产品 ID 不在任一组（组未覆盖该厂家/规格）
 *   EVIDENCE_NO_RULE   reviewed 说明书逐字候选覆盖，但规则库无对应规则（→ batch3 候选）
 *   MANUAL_MENTION_ONLY 相互作用段提及但未形成逐字风险候选 / 来源未 reviewed（→ 待清洗/人工）
 *   NO_SOURCE          相互作用段未见该药提及（不建规则；未覆盖 ≠ 无风险）
 *
 * 纪律：只读库 + 只读候选池；不写 seed、不改库、不生成规则内容；证据 ≠ 临床结论。
 * 用法（cd app）：
 *   pnpm --filter @anxin/api db:interaction-coverage -- --out ../../../data/m12-reports
 */
import '../lib/env.js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPlanActiveOn, todayStr, type InteractionLevel } from '@anxin/shared'
import { db, client } from '../db/client.js'
import { drugMaster, packageInserts, interactionRules, users, drugs, plans } from '../db/schema.js'
import { checkInteractions, type InteractionRuleInput } from '../services/rules/index.js'
import { aliasesForDrug, baseDrugName, expandQuoteToSentence } from '../services/rules/candidate-mining.js'
import { normalizeQuoteText, type RuleStatus } from '../services/rules/rule-curation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..', '..', '..')

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

/** CLI 相对路径按当前目录解析；缺省值按仓库根解析。 */
function inputPath(raw: string | null, fallbackRepoRel: string): string {
  return raw ? resolve(raw) : join(repoRoot, fallbackRepoRel)
}

const LEVEL_WEIGHT: Record<InteractionLevel, number> = { 禁忌: 4, 慎用: 3, 需监测: 2, 注意: 1 }
const LEVELS: InteractionLevel[] = ['禁忌', '慎用', '需监测', '注意']

type PairClass = 'COVERED' | 'ID_GAP' | 'EVIDENCE_NO_RULE' | 'MANUAL_MENTION_ONLY' | 'NO_SOURCE'

interface ComboSpec {
  id: string
  label: string
  scenario?: string
  drugs: string[]
}

interface Spec {
  note: string
  version: string
  combos: ComboSpec[]
}

interface MasterRow {
  id: string
  genericName: string
  brandName: string | null
  form: string | null
}

interface InsertRow {
  id: string
  drugId: string
  curationStatus: string
  source: string | null
  interactions: string | null
  sourceSections: Record<string, string> | null
  version: string | null
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
}

interface RuleRow {
  id: string
  drugIds: string[]
  drugGroups: string[][] | null
  level: InteractionLevel
  note: string
  source: string
  status: RuleStatus
}

interface EvidenceItem {
  index: number
  level: InteractionLevel
  sourceGenericName: string
  candidateGenericNames: string[]
  quote: string
  ambiguous: boolean
  aliasKind: string
  verbatimOk: boolean
  sourceStatus: string
  sourceInsertId: string
}

interface MentionItem {
  byDrugId: string
  byGenericName: string
  sourceStatus: string
}

interface IdGapItem {
  ruleId: string
  ruleStatus: string
  concept: string
  chosenId: string
  groupConceptIds: string[]
}

interface PairResult {
  a: string
  b: string
  aName: string
  bName: string
  classification: PairClass
  curatedCovered: boolean
  demoCovered: boolean
  evidence: EvidenceItem[]
  mentions: MentionItem[]
  idGapRules: IdGapItem[]
}

interface HitItem {
  ruleId: string
  level: InteractionLevel
  status: string
  note: string
  source: string
  drugNames: string[]
}

interface SetAnalysis {
  label: string
  drugNames: string[]
  ids: string[]
  hits: HitItem[]
  coverageNote: string | null
  pairs: PairResult[]
  pairSummary: Record<PairClass, number> & { total: number; coveredCurated: number; coveredDemoOnly: number }
}

interface ComboResult extends SetAnalysis {
  id: string
  scenario?: string
}

function conceptOfName(name: string): string {
  return baseDrugName(name) || name
}

function shortText(text: string, n = 64): string {
  const t = String(text ?? '').replace(/[\r\n]+/g, '')
  return t.length > n ? `${t.slice(0, n)}…` : t
}

function matchRule(rule: RuleRow, idSet: Set<string>): string[] | null {
  if (rule.drugGroups && rule.drugGroups.length >= 2) {
    const perGroup: string[] = []
    for (const group of rule.drugGroups) {
      const hit = group.find((id) => idSet.has(id))
      if (!hit) return null
      perGroup.push(hit)
    }
    return perGroup
  }
  const ids = rule.drugIds ?? []
  return ids.length >= 2 && ids.every((id) => idSet.has(id)) ? ids : null
}

function ruleCoversPair(rule: RuleRow, conceptA: string, conceptB: string, conceptById: Map<string, string>): boolean {
  const groups = rule.drugGroups && rule.drugGroups.length >= 2 ? rule.drugGroups : null
  const hasConcept = (ids: string[], concept: string) => ids.some((id) => conceptById.get(id) === concept)
  if (groups) {
    const ia = groups.findIndex((g) => hasConcept(g, conceptA))
    const ib = groups.findIndex((g) => hasConcept(g, conceptB))
    return ia >= 0 && ib >= 0 && ia !== ib
  }
  const ids = rule.drugIds ?? []
  return hasConcept(ids, conceptA) && hasConcept(ids, conceptB)
}

async function main(): Promise<number> {
  const outDir = inputPath(arg('--out'), join('data', 'm12-reports'))
  const specPath = inputPath(arg('--spec'), join('data', 'm12-reports', 'coverage-spec.json'))
  const candidatesPath = inputPath(arg('--candidates'), join('data', 'm9-reports', 'rule-candidates.jsonl'))
  mkdirSync(outDir, { recursive: true })

  const started = Date.now()
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as Spec
  const candidates = readFileSync(candidatesPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Candidate)

  // ── 1. 取数 ───────────────────────────────────────────────────────────────
  const masterRows = (await db
    .select({ id: drugMaster.id, genericName: drugMaster.genericName, brandName: drugMaster.brandName, form: drugMaster.form })
    .from(drugMaster)) as MasterRow[]
  const insertRows = (await db
    .select({
      id: packageInserts.id,
      drugId: packageInserts.drugId,
      curationStatus: packageInserts.curationStatus,
      source: packageInserts.source,
      interactions: packageInserts.interactions,
      sourceSections: packageInserts.sourceSections,
      version: packageInserts.version,
    })
    .from(packageInserts)) as InsertRow[]
  const ruleRows: RuleRow[] = (
    await db
      .select({
        id: interactionRules.id,
        drugIds: interactionRules.drugIds,
        drugGroups: interactionRules.drugGroups,
        level: interactionRules.level,
        note: interactionRules.note,
        source: interactionRules.source,
        status: interactionRules.status,
      })
      .from(interactionRules)
  ).map((r) => ({
    id: r.id,
    drugIds: (r.drugIds as string[] | null) ?? [],
    drugGroups: (r.drugGroups as string[][] | null) ?? null,
    level: r.level as InteractionLevel,
    note: r.note,
    source: r.source,
    status: r.status as RuleStatus,
  }))
  const ruleInputs: InteractionRuleInput[] = ruleRows.map((r) => ({
    id: r.id,
    drugIds: r.drugIds,
    drugGroups: r.drugGroups,
    level: r.level,
    note: r.note,
    source: r.source,
    status: r.status,
  }))

  // ── 2. 索引与工具 ─────────────────────────────────────────────────────────
  const masterById = new Map(masterRows.map((m) => [m.id, m]))
  const insertByDrugId = new Map<string, InsertRow>()
  for (const ins of insertRows) if (!insertByDrugId.has(ins.drugId)) insertByDrugId.set(ins.drugId, ins)
  const insertById = new Map(insertRows.map((ins) => [ins.id, ins]))
  const conceptById = new Map<string, string>()
  const conceptIds = new Map<string, string[]>()
  const conceptDisplay = new Map<string, string>()
  for (const m of masterRows) {
    const concept = conceptOfName(m.genericName)
    conceptById.set(m.id, concept)
    if (!conceptDisplay.has(concept)) conceptDisplay.set(concept, m.genericName)
    const list = conceptIds.get(concept) ?? []
    list.push(m.id)
    conceptIds.set(concept, list)
  }
  const nameById: Record<string, string> = Object.fromEntries(masterRows.map((m) => [m.id, m.genericName]))
  const reviewedDrugIds = new Set(insertRows.filter((i) => i.curationStatus === 'reviewed').map((i) => i.drugId))

  const resolveMaster = (name: string): MasterRow => {
    const concept = conceptOfName(name)
    const exact = masterRows.filter((m) => m.genericName === name)
    const pool = exact.length > 0 ? exact : masterRows.filter((m) => conceptOfName(m.genericName) === concept)
    if (pool.length === 0) throw new Error(`组合药品在库中不存在：${name}`)
    const reviewed = pool.filter((m) => reviewedDrugIds.has(m.id))
    return (reviewed.length > 0 ? reviewed : pool).slice().sort((a, b) => a.id.localeCompare(b.id))[0]
  }

  // 候选证据缓存（同一概念对只算一次）
  const evidenceCache = new Map<string, EvidenceItem[]>()
  const evidenceForPair = (conceptA: string, conceptB: string): EvidenceItem[] => {
    const key = [conceptA, conceptB].sort().join('|')
    const cached = evidenceCache.get(key)
    if (cached) return cached
    const out: EvidenceItem[] = []
    const seen = new Set<string>()
    candidates.forEach((c, index) => {
      const srcConcept = conceptById.get(c.sourceDrugId) ?? conceptOfName(c.sourceGenericName)
      const candConcepts = new Set<string>()
      for (const id of c.candidateDrugIds ?? []) {
        const concept = conceptById.get(id)
        if (concept) candConcepts.add(concept)
      }
      for (const n of c.candidateGenericNames ?? []) candConcepts.add(conceptOfName(n))
      const match = (srcConcept === conceptA && candConcepts.has(conceptB)) || (srcConcept === conceptB && candConcepts.has(conceptA))
      if (!match) return
      const dedupeKey = `${c.sourceDrugId}|${c.quote}`
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      const insert = insertById.get(c.sourceInsertId)
      const sectionText = insert?.sourceSections?.[c.sectionKey] ?? insert?.interactions ?? ''
      const expanded = expandQuoteToSentence(sectionText, c.quote) ?? c.quote
      const verbatimOk = normalizeQuoteText(sectionText).includes(normalizeQuoteText(expanded))
      out.push({
        index,
        level: c.level,
        sourceGenericName: c.sourceGenericName,
        candidateGenericNames: c.candidateGenericNames ?? [],
        quote: expanded,
        ambiguous: c.ambiguous,
        aliasKind: c.aliasKind,
        verbatimOk,
        sourceStatus: insert?.curationStatus ?? 'unknown',
        sourceInsertId: c.sourceInsertId,
      })
    })
    out.sort((a, b) => LEVEL_WEIGHT[b.level] - LEVEL_WEIGHT[a.level] || a.index - b.index)
    evidenceCache.set(key, out)
    return out
  }

  const mentionsOf = (source: MasterRow, other: MasterRow): MentionItem | null => {
    const insert = insertByDrugId.get(source.id)
    if (!insert) return null
    const sectionText = insert.sourceSections?.['药物相互作用'] ?? insert.interactions ?? ''
    if (!sectionText.trim()) return null
    const aliases = aliasesForDrug(other).filter((a) => a.length >= 2)
    return aliases.some((a) => sectionText.includes(a))
      ? { byDrugId: source.id, byGenericName: source.genericName, sourceStatus: insert.curationStatus }
      : null
  }
  const mentionsForPair = (a: MasterRow, b: MasterRow): MentionItem[] => {
    const out: MentionItem[] = []
    const m1 = mentionsOf(a, b)
    if (m1) out.push(m1)
    const m2 = mentionsOf(b, a)
    if (m2) out.push(m2)
    return out
  }

  // ── 3. 单个用药集合分析 ───────────────────────────────────────────────────
  function analyzeSet(label: string, inputIds: string[]): SetAnalysis {
    const ids = [...new Set(inputIds.filter(Boolean))]
    const idSet = new Set(ids)
    const drugNames = ids.map((id) => masterById.get(id)?.genericName ?? nameById[id] ?? id)
    const explained = ruleRows
      .map((rule) => ({ rule, matchedIds: matchRule(rule, idSet) }))
      .filter((x): x is { rule: RuleRow; matchedIds: string[] } => Boolean(x.matchedIds))
    const engine = checkInteractions(ids, ruleInputs, nameById)
    if (engine.hits.length !== explained.length) {
      throw new Error(`规则引擎与报告匹配不一致（${label}）：引擎 ${engine.hits.length} 条 / 报告 ${explained.length} 条`)
    }
    const hits: HitItem[] = explained
      .map(({ rule, matchedIds }) => ({
        ruleId: rule.id,
        level: rule.level,
        status: rule.status,
        note: rule.note,
        source: rule.source,
        drugNames: matchedIds.map((id) => masterById.get(id)?.genericName ?? id),
      }))
      .sort((a, b) => LEVEL_WEIGHT[b.level] - LEVEL_WEIGHT[a.level])

    const pairs: PairResult[] = []
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]
        const b = ids[j]
        const conceptA = conceptById.get(a) ?? conceptOfName(nameById[a] ?? a)
        const conceptB = conceptById.get(b) ?? conceptOfName(nameById[b] ?? b)
        if (conceptA === conceptB) continue

        const matchedRules = explained
          .filter(({ matchedIds }) => {
            const concepts = new Set(matchedIds.map((id) => conceptById.get(id)))
            return concepts.has(conceptA) && concepts.has(conceptB)
          })
          .map(({ rule }) => rule)
        const coveringRules = ruleRows.filter((rule) => ruleCoversPair(rule, conceptA, conceptB, conceptById))
        const evidence = evidenceForPair(conceptA, conceptB)
        const mentions = mentionsForPair(masterById.get(a)!, masterById.get(b)!)

        let classification: PairClass
        if (matchedRules.length > 0) classification = 'COVERED'
        else if (coveringRules.length > 0) classification = 'ID_GAP'
        else if (evidence.length > 0) classification = 'EVIDENCE_NO_RULE'
        else if (mentions.length > 0) classification = 'MANUAL_MENTION_ONLY'
        else classification = 'NO_SOURCE'

        const idGapRules: IdGapItem[] = []
        if (classification === 'ID_GAP') {
          for (const rule of coveringRules) {
            const groups = rule.drugGroups && rule.drugGroups.length >= 2 ? rule.drugGroups : [rule.drugIds]
            for (const concept of [conceptA, conceptB]) {
              const chosenId = conceptOfName(concept) === conceptA ? a : b
              const group = groups.find((g) => g.some((id) => conceptById.get(id) === concept))
              if (!group) continue
              const groupConceptIds = group.filter((id) => conceptById.get(id) === concept)
              if (!groupConceptIds.includes(chosenId)) {
                idGapRules.push({ ruleId: rule.id, ruleStatus: rule.status, concept: conceptDisplay.get(concept) ?? concept, chosenId, groupConceptIds })
              }
            }
          }
        }

        pairs.push({
          a,
          b,
          aName: masterById.get(a)?.genericName ?? a,
          bName: masterById.get(b)?.genericName ?? b,
          classification,
          curatedCovered: matchedRules.some((r) => r.status === 'curated'),
          demoCovered: matchedRules.some((r) => r.status === 'demo'),
          evidence,
          mentions,
          idGapRules,
        })
      }
    }

    const pairSummary = {
      total: pairs.length,
      COVERED: pairs.filter((p) => p.classification === 'COVERED').length,
      ID_GAP: pairs.filter((p) => p.classification === 'ID_GAP').length,
      EVIDENCE_NO_RULE: pairs.filter((p) => p.classification === 'EVIDENCE_NO_RULE').length,
      MANUAL_MENTION_ONLY: pairs.filter((p) => p.classification === 'MANUAL_MENTION_ONLY').length,
      NO_SOURCE: pairs.filter((p) => p.classification === 'NO_SOURCE').length,
      coveredCurated: pairs.filter((p) => p.classification === 'COVERED' && p.curatedCovered).length,
      coveredDemoOnly: pairs.filter((p) => p.classification === 'COVERED' && !p.curatedCovered && p.demoCovered).length,
    }
    return { label, drugNames, ids, hits, coverageNote: engine.coverageNote, pairs, pairSummary }
  }

  // ── 4. 代表组合 ───────────────────────────────────────────────────────────
  const comboResults: ComboResult[] = spec.combos.map((combo) => {
    const masters = combo.drugs.map(resolveMaster)
    const uniqueMasters = [...new Map(masters.map((m) => [m.id, m])).values()]
    const analysis = analyzeSet(combo.label, uniqueMasters.map((m) => m.id))
    return {
      ...analysis,
      id: combo.id,
      scenario: combo.scenario,
      drugNames: uniqueMasters.map((m) => m.genericName),
    }
  })

  // ── 5. 本地模拟用户（今日生效计划集合，引擎同口径）────────────────────────
  const today = todayStr()
  const userRows = await db.select({ id: users.id, name: users.name }).from(users)
  const planRows = await db
    .select({ userId: plans.userId, drugId: plans.drugId, status: plans.status, startDate: plans.startDate, endDate: plans.endDate })
    .from(plans)
  const boxRows = await db
    .select({ id: drugs.id, userId: drugs.userId, drugMasterId: drugs.drugMasterId, genericName: drugs.genericName, confirmStatus: drugs.confirmStatus })
    .from(drugs)

  const userResults = userRows
    .map((user) => {
      const box = boxRows.filter((d) => d.userId === user.id)
      const userPlans = planRows.filter((p) => p.userId === user.id)
      const activeMasterIds = box
        .filter((d) => d.drugMasterId && userPlans.some((p) => p.drugId === d.id && isPlanActiveOn(p, today)))
        .map((d) => d.drugMasterId as string)
      const boxMasterIds = box.map((d) => d.drugMasterId).filter((v): v is string => Boolean(v))
      const analysis = activeMasterIds.length >= 2 ? analyzeSet(`${user.id} 今日生效计划`, activeMasterIds) : null
      return {
        userId: user.id,
        name: user.name,
        boxCount: box.length,
        boxWithMaster: boxMasterIds.length,
        manualNoMaster: box.filter((d) => !d.drugMasterId).length,
        activePlanDrugs: activeMasterIds.length,
        activeAnalysis: analysis,
      }
    })
    .filter((u) => u.boxCount > 0)

  const multiUsers = userResults.filter((u) => u.activeAnalysis)

  // ── 6. batch3 候选推荐（证据对里挑：未覆盖 + 逐字 + 分级高）───────────────
  type Rec = { evidence: EvidenceItem; comboIds: string[]; pairs: string[]; count: number; score: number }
  const recMap = new Map<number, Rec>()
  for (const combo of comboResults) {
    for (const pair of combo.pairs) {
      if (pair.classification !== 'EVIDENCE_NO_RULE') continue
      for (const evidence of pair.evidence) {
        if (!evidence.verbatimOk) continue
        const key = evidence.index
        const rec = recMap.get(key) ?? { evidence, comboIds: [], pairs: [], count: 0, score: 0 }
        if (!rec.comboIds.includes(combo.id)) rec.comboIds.push(combo.id)
        const pairLabel = `${pair.aName} × ${pair.bName}`
        if (!rec.pairs.includes(pairLabel)) rec.pairs.push(pairLabel)
        rec.count = rec.pairs.length
        rec.score =
          LEVEL_WEIGHT[evidence.level] * 100 +
          (evidence.ambiguous ? 0 : 15) +
          (evidence.aliasKind === 'full' ? 5 : 0) +
          Math.min(rec.count, 5) * 3 +
          10
        recMap.set(key, rec)
      }
    }
  }
  const recommended = [...recMap.values()]
    .sort((a, b) => b.score - a.score || a.evidence.index - b.evidence.index)
    .slice(0, 30)
    .map((r) => ({
      candidateIndex: r.evidence.index,
      level: r.evidence.level,
      pair: r.pairs.join(' / '),
      combos: r.comboIds,
      sourceGenericName: r.evidence.sourceGenericName,
      candidateGenericNames: r.evidence.candidateGenericNames,
      quote: r.evidence.quote,
      ambiguous: r.evidence.ambiguous,
      aliasKind: r.evidence.aliasKind,
      verbatimOk: r.evidence.verbatimOk,
      sourceStatus: r.evidence.sourceStatus,
      sourceInsertId: r.evidence.sourceInsertId,
      score: r.score,
    }))

  const idGaps = comboResults.flatMap((combo) =>
    combo.pairs
      .filter((p) => p.classification === 'ID_GAP')
      .map((p) => ({
        combo: combo.id,
        pair: `${p.aName} × ${p.bName}`,
        rules: p.idGapRules,
      })),
  )
  const manualOnly = comboResults.flatMap((combo) =>
    combo.pairs
      .filter((p) => p.classification === 'MANUAL_MENTION_ONLY')
      .map((p) => ({ combo: combo.id, pair: `${p.aName} × ${p.bName}`, mentions: p.mentions })),
  )

  const totals = {
    combos: comboResults.length,
    combosWithAnyHit: comboResults.filter((c) => c.hits.length > 0).length,
    combosWithCuratedHit: comboResults.filter((c) => c.hits.some((h) => h.status === 'curated')).length,
    combosWithoutHit: comboResults.filter((c) => c.hits.length === 0).length,
    pairs: comboResults.reduce((n, c) => n + c.pairSummary.total, 0),
    covered: comboResults.reduce((n, c) => n + c.pairSummary.COVERED, 0),
    coveredCurated: comboResults.reduce((n, c) => n + c.pairSummary.coveredCurated, 0),
    coveredDemoOnly: comboResults.reduce((n, c) => n + c.pairSummary.coveredDemoOnly, 0),
    idGap: comboResults.reduce((n, c) => n + c.pairSummary.ID_GAP, 0),
    evidenceNoRule: comboResults.reduce((n, c) => n + c.pairSummary.EVIDENCE_NO_RULE, 0),
    manualOnly: comboResults.reduce((n, c) => n + c.pairSummary.MANUAL_MENTION_ONLY, 0),
    noSource: comboResults.reduce((n, c) => n + c.pairSummary.NO_SOURCE, 0),
    recommendedCandidates: recommended.length,
  }

  const ruleStatusCount = ruleRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  const report = {
    generatedAt: new Date().toISOString(),
    elapsedMs: 0,
    spec: { path: specPath, version: spec.version, note: spec.note, combos: spec.combos.length },
    dataSnapshot: {
      today,
      packageInserts: insertRows.length,
      reviewed: insertRows.filter((i) => i.curationStatus === 'reviewed').length,
      candidates: candidates.length,
      interactionRules: ruleRows.length,
      ruleStatus: ruleStatusCount,
    },
    users: {
      totalUsers: userRows.length,
      usersWithBox: userResults.length,
      multiDrugActiveSets: multiUsers.length,
      rows: userResults.map((u) => ({
        userId: u.userId,
        boxCount: u.boxCount,
        boxWithMaster: u.boxWithMaster,
        manualNoMaster: u.manualNoMaster,
        activePlanDrugs: u.activePlanDrugs,
        activeAnalysis: u.activeAnalysis,
      })),
    },
    totals,
    combos: comboResults,
    idGaps,
    manualOnly,
    recommended,
    note: '只读报告：不写 seed、不改库、不生成规则内容；代表组合为构造场景，不是真实患者数据；候选证据来自 reviewed PDF 说明书相互作用段，入库前必须人工/药师签核。',
  }
  report.elapsedMs = Date.now() - started

  writeFileSync(join(outDir, 'interaction-coverage.json'), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(outDir, 'interaction-coverage.md'), renderMarkdown(report))
  console.log(
    `✅ 覆盖评估：${totals.combos} 个组合 · 命中 ${totals.combosWithAnyHit}/${totals.combos}（curated ${totals.combosWithCuratedHit}）· 药对 ${totals.pairs}：covered ${totals.covered}（curated ${totals.coveredCurated} / demo-only ${totals.coveredDemoOnly}）/ id-gap ${totals.idGap} / evidence ${totals.evidenceNoRule} / mention-only ${totals.manualOnly} / no-source ${totals.noSource}`,
  )
  console.log(`   batch3 推荐候选 ${recommended.length} 条（前 3：${recommended.slice(0, 3).map((r) => `#${r.candidateIndex} ${r.level} ${r.pair}`).join(' | ')}）`)
  console.log(`   输出：${join(outDir, 'interaction-coverage.json')} / interaction-coverage.md`)
  return 0
}

// ---------------------------------------------------------------------------
// Markdown 报告
// ---------------------------------------------------------------------------

interface ReportLike {
  generatedAt: string
  elapsedMs: number
  spec: { path: string; version: string; note: string; combos: number }
  dataSnapshot: {
    today: string
    packageInserts: number
    reviewed: number
    candidates: number
    interactionRules: number
    ruleStatus: Record<string, number>
  }
  users: {
    totalUsers: number
    usersWithBox: number
    multiDrugActiveSets: number
    rows: Array<{
      userId: string
      boxCount: number
      boxWithMaster: number
      manualNoMaster: number
      activePlanDrugs: number
      activeAnalysis: SetAnalysis | null
    }>
  }
  totals: {
    combos: number
    combosWithAnyHit: number
    combosWithCuratedHit: number
    combosWithoutHit: number
    pairs: number
    covered: number
    coveredCurated: number
    coveredDemoOnly: number
    idGap: number
    evidenceNoRule: number
    manualOnly: number
    noSource: number
    recommendedCandidates: number
  }
  combos: ComboResult[]
  idGaps: Array<{ combo: string; pair: string; rules: IdGapItem[] }>
  manualOnly: Array<{ combo: string; pair: string; mentions: MentionItem[] }>
  recommended: Array<{
    candidateIndex: number
    level: InteractionLevel
    pair: string
    combos: string[]
    sourceGenericName: string
    candidateGenericNames: string[]
    quote: string
    ambiguous: boolean
    aliasKind: string
    verbatimOk: boolean
    sourceStatus: string
    sourceInsertId: string
    score: number
  }>
  note: string
}

function levelText(hits: HitItem[]): string {
  if (hits.length === 0) return '—'
  const byLevel = LEVELS.map((l) => {
    const n = hits.filter((h) => h.level === l).length
    return n > 0 ? `${l} ${n}` : ''
  }).filter(Boolean)
  return `${byLevel.join(' / ')}（${hits.map((h) => (h.status === 'curated' ? 'curated' : 'demo')).join('/')}）`
}

function renderMarkdown(report: ReportLike): string {
  const t = report.totals
  const md: string[] = []
  md.push('# M12 · 相互作用规则覆盖评估（真实用药组合 × 现有规则库）')
  md.push('')
  md.push(`> 生成：${report.generatedAt} · 耗时 ${(report.elapsedMs / 1000).toFixed(1)}s · 组合清单：[coverage-spec.json](./coverage-spec.json)`)
  md.push('> 性质：**只读报告**。不写 seed、不改库、不生成规则内容；组合为构造的代表性场景，**不是真实患者数据**。')
  md.push('')
  md.push('## §0 结论（先看这段）')
  md.push('')
  md.push(
    `- 代表组合 **${t.combos}** 个 / 药对 **${t.pairs}**：规则命中 **${t.covered}** 对（curated **${t.coveredCurated}** / demo-only **${t.coveredDemoOnly}**）；未覆盖 **${t.pairs - t.covered}** 对。`,
  )
  md.push(
    `- 未覆盖分类：**ID_GAP ${t.idGap}**（规则概念有、产品 ID 不在组内）/ **EVIDENCE_NO_RULE ${t.evidenceNoRule}**（reviewed 说明书逐字候选有、规则没有）/ **MENTION_ONLY ${t.manualOnly}**（仅原文提及）/ **NO_SOURCE ${t.noSource}**（相互作用段无提及）。`,
  )
  md.push(
    `- 组合层面：${t.combos} 个组合里 ${t.combosWithAnyHit} 个至少有 1 条命中（含 demo），其中 ${t.combosWithCuratedHit} 个有 curated 命中；**${t.combosWithoutHit} 个组合当前完全无规则命中**。`,
  )
  const evidencePairList = report.combos.flatMap((c) =>
    c.pairs.filter((p) => p.classification === 'EVIDENCE_NO_RULE').map((p) => `${c.id} ${p.aName}×${p.bName}`),
  )
  md.push(
    `- 证据对剩 **${evidencePairList.length}** 个（${evidencePairList.join('；') || '无'}），对应 ${t.recommendedCandidates} 条候选句（见 §4.1/§5；仍需工程预审 + 人工/药师签核）。`,
  )
  md.push('')
  md.push(
    `**一句话**：${t.combos} 个代表组合里 ${t.combosWithCuratedHit} 个有 curated 规则命中；未覆盖的 ${t.pairs - t.covered} 对中，${t.evidenceNoRule} 对有 reviewed 说明书逐字证据（适合下一批签核），${t.manualOnly} 对仅原文提及，${t.noSource} 对在相互作用段未见提及（既可能真无相互作用，也可能说明书未覆盖——需临床判断，**不能据此判定安全**）。`,
  )
  md.push('')
  md.push('## §1 口径与方法')
  md.push('')
  md.push('| 项 | 口径 |')
  md.push('|---|---|')
  md.push(`| 组合来源 | \`data/m12-reports/coverage-spec.json\`（${report.spec.combos} 个真实世界常见场景，构造组合；非真实患者数据） |`)
  md.push(`| 药品解析 | 按说明书库 \`drug_master\` 通用名匹配；同通用名多产品优先 reviewed，再按 ID 稳定排序 |`)
  md.push(`| 匹配引擎 | 复用线上 \`checkInteractions\`（\`services/rules/interactions.ts\`）+ 同一份 \`interaction_rules\`（${report.dataSnapshot.interactionRules} 条）；报告内逐条复算并与引擎结果对账 |`)
  md.push('| 药对判据 | 见下；「evidence」= M9 候选池中**原文逐字**包含该药对、且来源说明书 reviewed 的候选句 |')
  md.push('| 数据快照 | package_inserts ' + report.dataSnapshot.packageInserts + ' / reviewed ' + report.dataSnapshot.reviewed + ' / interaction_rules ' + report.dataSnapshot.interactionRules + '（' + Object.entries(report.dataSnapshot.ruleStatus).map(([k, v]) => `${k}=${v}`).join(' / ') + '）/ 候选池 ' + report.dataSnapshot.candidates + ' 条 |')
  md.push('| 今日 | ' + report.dataSnapshot.today + '（本地时区） |')
  md.push('')
  md.push('| 分类 | 含义 | 处置方向 |')
  md.push('|---|---|---|')
  md.push('| **COVERED** | 现有规则命中（curated/demo 分列） | 已覆盖；demo 条目仍属演示级 |')
  md.push('| **ID_GAP** | 规则概念对存在，但该用户产品 ID 不在任一组 | 工程：把该产品 ID 扩进组（或确认该产品不应覆盖） |')
  md.push('| **EVIDENCE_NO_RULE** | reviewed 说明书逐字候选句覆盖此药对，规则库无对应规则 | batch3 签核候选（不自动入库） |')
  md.push('| **MANUAL_MENTION_ONLY** | 相互作用段提及但未成候选（或来源未 reviewed） | 先 reviewed 扩面 / 人工判读 |')
  md.push('| **NO_SOURCE** | 相互作用段未提及对方药 | 不建规则；UI 显示「未覆盖 ≠ 无风险」 |')
  md.push('')
  md.push('> 边界：证据 = 说明书原文抄录候选，不等于临床结论；分级只是候选建议，最终由人工/药师确认。demo 规则内容不可逐字校验，单列为 demo。')
  md.push('')
  md.push('## §2 本地模拟用户实测（可复算）')
  md.push('')
  md.push(`本地共 ${report.users.totalUsers} 个用户、${report.users.usersWithBox} 个有药箱记录；**构成多药生效集合的只有 ${report.users.multiDrugActiveSets} 个**（其余为单药或手动建档无 drug_master 匹配）。`)
  md.push('')
  md.push('| 用户 | 药箱 | 可匹配 master | 手动无 master | 今日生效 | 组合结论 |')
  md.push('|---|---|---|---|---|---|')
  for (const u of report.users.rows) {
    const a = u.activeAnalysis
    const verdict = a
      ? `${a.hits.length} 条命中（${levelText(a.hits)}）；药对 ${a.pairSummary.total}：covered ${a.pairSummary.COVERED} / id-gap ${a.pairSummary.ID_GAP} / evidence ${a.pairSummary.EVIDENCE_NO_RULE} / mention ${a.pairSummary.MANUAL_MENTION_ONLY} / no-source ${a.pairSummary.NO_SOURCE}`
      : '不足 2 个可匹配药品，不触发组合检查'
    md.push(`| ${u.userId} | ${u.boxCount} | ${u.boxWithMaster} | ${u.manualNoMaster} | ${u.activePlanDrugs} | ${verdict} |`)
  }
  const p001 = report.users.rows.find((u) => u.activeAnalysis)
  if (p001?.activeAnalysis) {
    md.push('')
    md.push(`**${p001.userId} 明细**：今日生效 ${p001.activeAnalysis.drugNames.join(' + ')}。`)
    for (const h of p001.activeAnalysis.hits) {
      md.push(`- 命中 ${h.ruleId}（${h.level} / ${h.status}）：${h.drugNames.join(' × ')} — ${shortText(h.note, 60)}`)
    }
    md.push('')
    md.push('> 注：p-001 药箱 5 药，其中玻璃酸钠滴眼液计划已于 2026-09-09 结束，不计入「今日生效」；演示药箱 4 个 `confirm_status=manual` 仍参与相互作用检查（仅挡咨询 L1）。')
  }
  md.push('')
  md.push('## §3 代表组合覆盖总表')
  md.push('')
  md.push('| # | 组合 | 药（→实际匹配产品） | 命中 | 药对覆盖（covered/id-gap/evidence/mention/no-source） |')
  md.push('|---|---|---|---|---|')
  for (const c of report.combos) {
    const ps = c.pairSummary
    md.push(
      `| ${c.id} | ${c.label} | ${c.drugNames.join(' / ')} | ${c.hits.length ? levelText(c.hits) : '**无命中**'} | ${ps.total} 对：${ps.COVERED}/${ps.ID_GAP}/${ps.EVIDENCE_NO_RULE}/${ps.MANUAL_MENTION_ONLY}/${ps.NO_SOURCE} |`,
    )
  }
  md.push('')
  md.push('> 命中括号内为规则状态（curated/demo）。demo 仅表示「有提示但不可逐字校验」，不算正式覆盖。')
  md.push('')
  md.push('## §4 漏检明细')
  md.push('')
  md.push('### 4.1 EVIDENCE_NO_RULE：reviewed 说明书有逐字证据、规则库没有')
  md.push('')
  const evidenceRows = report.combos.flatMap((c) =>
    c.pairs.filter((p) => p.classification === 'EVIDENCE_NO_RULE').map((p) => ({ combo: c.id, pair: p })),
  )
  if (evidenceRows.length === 0) {
    md.push('（无）')
  } else {
    md.push('| 组合 | 药对 | 证据分级 | 候选 # | 候选药 | 原文（截断） | 歧义 |')
    md.push('|---|---|---|---|---|---|---|')
    for (const { combo, pair } of evidenceRows) {
      const best = pair.evidence[0]
      md.push(
        `| ${combo} | ${pair.aName} × ${pair.bName} | ${pair.evidence.map((e) => e.level).join(' / ')} | ${pair.evidence.map((e) => `#${e.index}`).join(', ')} | ${pair.evidence.map((e) => e.candidateGenericNames.join('+')).join('; ')} | ${shortText(best.quote, 72)} | ${best.ambiguous ? '是' : '否'} |`,
      )
    }
  }
  md.push('')
  md.push('### 4.2 ID_GAP：规则概念对存在、但产品 ID 不在组（工程缺口）')
  md.push('')
  if (report.idGaps.length === 0) {
    md.push('（无）')
  } else {
    md.push('| 组合 | 药对 | 规则 | 缺失概念 | 组内同概念 ID |')
    md.push('|---|---|---|---|---|')
    for (const g of report.idGaps) {
      const detail = g.rules
        .map((r) => `${r.ruleId}（${r.ruleStatus}）：${r.concept} 组缺 ${r.chosenId}，组内已有 ${r.groupConceptIds.length} 个同概念 ID`)
        .join('；')
      md.push(`| ${g.combo} | ${g.pair} | ${g.rules.map((r) => r.ruleId).join(', ')} | ${g.rules.map((r) => r.concept).join(' / ')} | ${detail} |`)
    }
  }
  md.push('')
  md.push('### 4.3 MANUAL_MENTION_ONLY：仅相互作用段提及（未成逐字候选 / 来源未 reviewed）')
  md.push('')
  if (report.manualOnly.length === 0) {
    md.push('（无）')
  } else {
    md.push('| 组合 | 药对 | 提及来源（reviewed?） |')
    md.push('|---|---|---|')
    for (const m of report.manualOnly) {
      md.push(`| ${m.combo} | ${m.pair} | ${m.mentions.map((x) => `${x.byGenericName}（${x.sourceStatus}）`).join(' / ')} |`)
    }
  }
  md.push('')
  md.push('### 4.4 NO_SOURCE：相互作用段未见对方药')
  md.push('')
  md.push(`共 **${t.noSource}** 对（组合 ${t.combos} 个里的药对）。这些药对在现有说明书相互作用段里**找不到对方药**，按 PRD §7.8.1 来源限定**不建规则**；但 NO_SOURCE ≠ 无风险（可能真无相互作用，也可能说明书未覆盖/来源未 reviewed），不得据此判定安全。明细见 JSON \`combos[].pairs[].classification=NO_SOURCE\`。`)
  md.push('')
  md.push('## §5 下一批候选（从 evidence 对里筛出，仍需人工签核）')
  md.push('')
  md.push(`共 ${report.recommended.length} 条；排序 = 分级权重 + 非歧义 + 原文全名 + 出现组合数。**只产出候选清单，不入库、不改 seed。**`)
  md.push('')
  md.push('> 工程预审后已按此清单产出 batch3 签核包（**15 条**，一个药对一条规则）：`data/m11-reports/signoff-batch3.final.{md,html,csv}`；**batch3 已于 2026-11-18 签核并入库（curated 35→50）**，入库记录见 `data/m11-reports/batch3-入库记录.md`。本报告为复跑快照，剩余候选以 §4.1 为准。')
  md.push('')
  md.push('| 候选 # | 级别 | 药对 | 来源药 | 原文（截断） | 歧义 | 来源 |')
  md.push('|---|---|---|---|---|---|---|')
  for (const r of report.recommended) {
    md.push(
      `| ${r.candidateIndex} | ${r.level} | ${r.pair} | ${r.sourceGenericName} | ${shortText(r.quote, 64)} | ${r.ambiguous ? '是' : '否'} | ${r.sourceStatus} |`,
    )
  }
  md.push('')
  md.push('## §6 结论与数据清洗依赖')
  md.push('')
  const eNo = report.combos.flatMap((c) => c.pairs.filter((p) => p.classification === 'EVIDENCE_NO_RULE'))
  const fromReviewed = eNo.flatMap((p) => p.evidence).filter((e) => e.sourceStatus === 'reviewed').length
  const mentionStatuses = report.manualOnly.flatMap((m) => m.mentions.map((x) => x.sourceStatus))
  const mentionCrawled = mentionStatuses.filter((s) => s !== 'reviewed').length
  md.push(
    `1. **规则库已覆盖一部分基础/高风险组合**：curated 命中 ${t.combosWithCuratedHit}/${t.combos} 个代表组合；但 ${t.combosWithoutHit} 个组合完全无命中，且 demo 命中（${t.coveredDemoOnly} 对）只是演示级、不可逐字校验，不算正式覆盖。`,
  )
  md.push(
    `2. **剩余最大的可补缺口是「有证据、没建规则」**：${t.evidenceNoRule} 个药对、${fromReviewed} 条 reviewed 逐字证据候选（涉及 ${report.recommended.length} 条候选句）；这批不依赖新的数据清洗，只依赖工程预审 + 人工/药师签核 → 适合作为下一批签核候选（§5；batch3 已入库 15 条，见入库记录）。`,
  )
  if (t.idGap === 0) {
    md.push('3. **本面板 ID_GAP = 0**：现有规则组在建组时已按概念扩面（同通用名多产品进同一 any-of 组），本次按 reviewed 产品解析未命中组外 ID；但换非 reviewed 产品/新厂家时仍建议抽样验证组覆盖。')
  } else {
    md.push(`3. **ID_GAP ${t.idGap} 对**是纯工程问题：规则组未覆盖用户实际产品 ID，应先扩组（或明确不覆盖），比继续堆规则更划算；明细见 §4.2。`)
  }
  md.push(
    `4. **MENTION_ONLY ${t.manualOnly} 对**：涉及说明书提及但未形成逐字候选；其中 ${mentionCrawled} 处来源为 crawled，必须先把说明书升 reviewed 才能建规则（数据清洗依赖），${mentionStatuses.length - mentionCrawled} 处来源 reviewed、需人工判读是否成候选。`,
  )
  md.push(
    `5. **NO_SOURCE ${t.noSource} 对**不建规则（PRD §7.8.1 来源限定），且**不能据此判定安全**：可能真无相互作用、也可能说明书未覆盖；应保留「未覆盖 ≠ 无风险」提示，必要时由药师补指南/公告来源。`,
  )
  md.push('6. 建议顺序：① 处理 §4.1 剩余证据对（C04 需补口服维拉帕米说明书；C05 证据质量低暂缓）→ ② 如有 ID_GAP 则扩组（无需签核）→ ③ reviewed 扩面（按真实药箱优先级，解决 MENTION_ONLY 与咨询 L0 门禁）→ ④ 真实试点数据回来后替换 spec 重跑本报告。')
  md.push('')
  md.push('## §7 复现与边界')
  md.push('')
  md.push('```bash')
  md.push('cd app')
  md.push('pnpm --filter @anxin/api db:interaction-coverage -- --out ../../../data/m12-reports')
  md.push('# 输出 data/m12-reports/interaction-coverage.{json,md}；只读库，不改 seed/DB')
  md.push('```')
  md.push('')
  md.push('- 组合由代理按常见临床场景构造（`coverage-spec.json` 有版本与说明），**不是真实患者处方数据**；真实用户数据要等试点（M12 §4-B）后替换 spec 重跑。')
  md.push('- 证据来自 M9 候选池（reviewed PDF 说明书相互作用段逐字句）；候选分级是确定性词表建议，非临床结论。')
  md.push('- demo 规则 3 条内容不可逐字校验（M8 已登记），本报告单列 demo，不计入 curated 覆盖。')
  return md.join('\n') + '\n'
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error('❌ 覆盖评估生成失败:', err)
    await client.end().catch(() => undefined)
    process.exit(1)
  })
