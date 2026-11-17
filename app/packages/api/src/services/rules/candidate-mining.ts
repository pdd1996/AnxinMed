/**
 * M9-T2 · 相互作用规则候选挖掘（纯函数）。
 *
 * 输入：reviewed PDF 说明书的【药物相互作用】原文段 + drug_master 药名索引。
 * 输出：逐字候选句（pair + quote + 来源 + 建议分级），供人工签核；**不生成规则、不写库**。
 *
 * 纪律（PRD §7.8.1）：
 * - 只从原文句子截取 quote；候选分级仅按确定性词表建议，最终必须人工确认；
 * - 「不改变/无影响/未见」类陈述不进风险候选；
 * - 药名归一只是辅助匹配（去剂型/盐基），命中结果必须回原文复核；
 * - 当前规则模型是 flat `drugIds`（全命中才触发），候选里的多个 drugIds 是「概念候选」，
 *   真正入库前需要决定按哪个具体药品行建规则——这属于人工签核步骤。
 */
import type { InteractionLevel } from '@anxin/shared'
import { INTERACTION_SECTION_KEYS } from './rule-curation.js'

export interface MasterDrug {
  id: string
  genericName: string
  brandName: string | null
  form: string | null
}

export interface SourceManual {
  insertId: string
  drugId: string
  genericName: string
  version: string | null
  sections: Record<string, string>
}

export interface AliasEntry {
  alias: string
  /** full=原文全名命中（genericName/brandName 原样）；stripped=去剂型/盐基后的归一匹配 */
  kind: 'full' | 'stripped'
  drugId: string
  genericName: string
}

export interface CandidateMention {
  matchedAlias: string
  candidateDrugIds: string[]
  candidateGenericNames: string[]
  ambiguous: boolean
}

export interface RuleCandidate {
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
  /** full=命中候选药原文全名；stripped=仅归一别名命中（需人工确认剂型/途径） */
  aliasKind: 'full' | 'stripped'
  level: InteractionLevel
  markers: { risk: string[]; noEffect: string[] }
}

export interface MiningStats {
  manuals: number
  manualsWithSection: number
  sentences: number
  candidates: number
  skippedNoEffect: number
  skippedSelfOnly: number
  skippedTable: number
  duplicateQuotes: number
}

const FORM_SUFFIXES = [
  '注射用无菌粉末', '注射用', '冻干粉针', '粉针', '注射液', '滴眼液', '滴鼻液', '滴耳液',
  '眼膏', '乳膏', '软膏', '凝胶剂', '凝胶', '喷雾剂', '气雾剂', '吸入剂', '滴剂',
  '缓释胶囊', '肠溶胶囊', '胶囊', '缓释片', '控释片', '肠溶片', '分散片', '咀嚼片',
  '泡腾片', '口腔崩解片', '口崩片', '片', '颗粒', '口服溶液', '口服液', '混悬液',
  '干混悬剂', '糖浆', '合剂', '胶浆', '散剂', '散', '丸', '栓', '贴剂', '贴',
  '洗剂', '酊', '搽剂', '霜', '乳', '溶液', '无菌粉末', '透析液', '鼻',
].sort((a, b) => b.length - a.length)

const SALT_PREFIXES = [
  '盐酸', '硫酸', '氢溴酸', '枸橼酸', '富马酸', '马来酸', '苯磺酸', '甲磺酸',
  '酒石酸', '琥珀酸', '醋酸', '乳酸', '磷酸', '硝酸', '氯化',
].sort((a, b) => b.length - a.length)

const NO_EFFECT_MARKERS = [
  '不改变', '不影响', '无影响', '未见', '未观察到', '无临床意义', '无相互作用',
  '不抑制', '不诱导', '不增加', '不减少', '无显著影响',
]

const RISK_MARKERS = [
  '禁止', '禁用', '不宜', '慎用', '避免', '风险', '增加', '升高', '降低', '增强', '减弱',
  '应监测', '密切监测', '监测', '注意', '谨慎', '中毒', '出血', '低血糖', '心律失常', '不良反应',
]

/** 常见「药名是检验词前缀」的假阳性：别名命中但句子实际在说别的词。 */
const FALSE_POSITIVE_PREFIXES: Array<{ alias: string; context: string }> = [
  { alias: '凝血酶', context: '凝血酶原' },
  { alias: '葡萄糖', context: '葡萄糖醛酸' },
]

function stripParens(name: string): string {
  return name.replace(/[（(][^）)]*[）)]/g, '')
}

function stripSuffixes(name: string): string {
  let out = name
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of FORM_SUFFIXES) {
      if (out.endsWith(suffix) && out.length - suffix.length >= 2) {
        out = out.slice(0, -suffix.length)
        changed = true
        break
      }
    }
  }
  return out
}

function stripSalts(name: string): string {
  let out = name
  let changed = true
  while (changed) {
    changed = false
    for (const prefix of SALT_PREFIXES) {
      if (out.startsWith(prefix) && out.length - prefix.length >= 2) {
        out = out.slice(prefix.length)
        changed = true
        break
      }
    }
  }
  return out
}

/** 生成一个药的别名（原文名、去括号、去剂型、去盐基；长度 ≥2，去重）。 */
export function aliasesForDrug(drug: MasterDrug): string[] {
  const raw = [drug.genericName, drug.brandName ?? '']
    .map((s) => stripParens(String(s ?? '').trim()))
    .filter(Boolean)
  const out = new Set<string>()
  for (const name of raw) {
    if (name.length < 2) continue
    out.add(name)
    const noForm = stripSuffixes(name)
    if (noForm.length >= 2) out.add(noForm)
    const noSalt = stripSalts(noForm)
    if (noSalt.length >= 2) out.add(noSalt)
    // 「XX 钠/钾/钙」这类盐尾，去剂型后再尝试去掉尾部单字盐基（仅当剩余 ≥2）
    const saltTail = noSalt.replace(/[钠钾钙镁铵]$/, '')
    if (saltTail.length >= 2 && saltTail !== noSalt) out.add(saltTail)
  }
  // 过滤剂型词本身、纯数字/罗马数字、过短
  return [...out].filter(
    (a) =>
      a.length >= 2 &&
      !/^[0-9.]+$/.test(a) &&
      !/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/.test(a) &&
      !['复方', '注射', '口服', '外用', '儿童', '成人'].includes(a),
  )
}

/** alias → 候选药品（同一通用名多产品会映射多 ID）。 */
export function buildAliasIndex(drugs: MasterDrug[]): Map<string, AliasEntry[]> {
  const index = new Map<string, AliasEntry[]>()
  for (const drug of drugs) {
    const fullNames = new Set(
      [stripParens(String(drug.genericName ?? '').trim()), stripParens(String(drug.brandName ?? '').trim())].filter(Boolean),
    )
    for (const alias of aliasesForDrug(drug)) {
      const list = index.get(alias) ?? []
      if (!list.some((e) => e.drugId === drug.id)) {
        list.push({ alias, kind: fullNames.has(alias) ? 'full' : 'stripped', drugId: drug.id, genericName: drug.genericName })
      }
      index.set(alias, list)
    }
  }
  return index
}

/** 药品「基名」：去括号/剂型/盐基/盐尾，用于判断是不是同一种活性成分（同通用名不同剂型）。 */
export function baseDrugName(name: string): string {
  return stripSalts(stripSuffixes(stripParens(String(name ?? '').trim()))).replace(/[钠钾钙镁铵]$/, '')
}

/** 按中文句号/分号/换行切句（保留标点，便于逐字 quote）；PDF 换行先合并，避免把一句话切成半句。 */
export function splitSentences(text: string): string[] {
  return (String(text ?? '').replace(/[\r\n]+/g, '').match(/[^。；;！？!?]+[。；;！？!?]?/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 把引文扩到完整句：从 quote 起点向后找最近句读（。；！？），并合并 PDF 换行。
 * 只向后扩、不向前扩，避免把上一段/标题并进来；quote 已以句读结尾则原样返回。
 * 找不到 quote 时返回 null。
 */
export function expandQuoteToSentence(text: string, quote: string): string | null {
  const raw = String(text ?? '')
  const pos = raw.indexOf(quote)
  if (pos < 0) return null
  const clean = (s: string) => s.replace(/[\r\n]+/g, '').trim()
  if (/[。；;！？!?]$/.test(quote.trim())) return clean(quote)
  let end = raw.length
  for (const b of ['。', '；', ';', '！', '？', '!', '?']) {
    const i = raw.indexOf(b, pos + quote.length)
    if (i >= 0 && i + 1 < end) end = i + 1
  }
  return clean(raw.slice(pos, end)) || clean(quote)
}

/**
 * 句子内找药名提及：从每个位置尝试最长匹配（aliases 最大长度起），命中后跳过该片段，
 * 避免「氨氯地平」里再匹配「地平」这类子串重复。
 */
export function findMentions(sentence: string, index: Map<string, AliasEntry[]>, maxAliasLength = 14): AliasEntry[] {
  const hits: AliasEntry[] = []
  let i = 0
  while (i < sentence.length) {
    let matched = false
    const maxLen = Math.min(maxAliasLength, sentence.length - i)
    for (let len = maxLen; len >= 2; len--) {
      const sub = sentence.slice(i, i + len)
      const entries = index.get(sub)
      if (entries && entries.length > 0) {
        hits.push(...entries)
        i += len
        matched = true
        break
      }
    }
    if (!matched) i++
  }
  return hits
}

export function classifySentence(sentence: string): { kind: 'risk' | 'no-effect' | 'none'; hitNoEffect: string[]; hitRisk: string[] } {
  const hitNoEffect = NO_EFFECT_MARKERS.filter((m) => sentence.includes(m))
  const hitRisk = RISK_MARKERS.filter((m) => sentence.includes(m))
  if (hitNoEffect.length > 0 && hitRisk.length === 0) return { kind: 'no-effect', hitNoEffect, hitRisk }
  if (hitRisk.length > 0) return { kind: 'risk', hitNoEffect, hitRisk }
  return { kind: 'none', hitNoEffect, hitRisk }
}

/** PRD 四级确定性建议（最终人工确认）。 */
export function suggestLevel(sentence: string): InteractionLevel {
  if (/禁止|禁用/.test(sentence)) return '禁忌'
  if (/慎用|不宜|避免/.test(sentence)) return '慎用'
  if (/监测|注意|谨慎/.test(sentence)) return '需监测'
  return '注意'
}

/**
 * 挖掘候选。单句内提及多个药时，按 (source, candidateDrugIds, quote) 去重合并。
 * 只保留风险句；无影响句、未分类句、只提及自身通用名的句子跳过。
 */
export function mineCandidates(
  manuals: SourceManual[],
  aliasIndex: Map<string, AliasEntry[]>,
): { candidates: RuleCandidate[]; stats: MiningStats } {
  const stats: MiningStats = {
    manuals: manuals.length,
    manualsWithSection: 0,
    sentences: 0,
    candidates: 0,
    skippedNoEffect: 0,
    skippedSelfOnly: 0,
    skippedTable: 0,
    duplicateQuotes: 0,
  }
  const candidates: RuleCandidate[] = []
  const seen = new Set<string>()

  for (const manual of manuals) {
    let sectionKey: string | null = null
    let sectionText = ''
    for (const key of INTERACTION_SECTION_KEYS) {
      const text = manual.sections[key] ?? ''
      if (text.trim()) {
        sectionKey = key
        sectionText = text
        break
      }
    }
    if (!sectionKey) continue
    stats.manualsWithSection += 1

    for (const sentence of splitSentences(sectionText)) {
      stats.sentences += 1
      // 表格行（Markdown 管道残留）里多药并列，单句归属不可靠；本轮只从散文句挖候选
      if (sentence.includes('｜') || sentence.includes('|')) {
        stats.skippedTable += 1
        continue
      }
      const mentions = findMentions(sentence, aliasIndex)
      if (mentions.length === 0) continue

      const sourceNormalized = baseDrugName(manual.genericName) || manual.genericName
      const sourceBase = baseDrugName(manual.genericName)
      const foreign = mentions.filter((m) => {
        const candBase = baseDrugName(m.genericName)
        if (m.drugId === manual.drugId) return false
        if (!candBase || !sourceBase) return true
        // 同成分 / 复方自身成分（如 氨氯地平阿托伐他汀 → 阿托伐他汀）/ 名称包含关系 → 视为自身
        if (candBase === sourceBase || sourceBase.includes(candBase) || candBase.includes(sourceBase)) return false
        // 常见「药名是检验词前缀」的假阳性
        if (FALSE_POSITIVE_PREFIXES.some((fp) => m.alias === fp.alias && sentence.includes(fp.context))) return false
        return true
      })
      if (foreign.length === 0) {
        stats.skippedSelfOnly += 1
        continue
      }

      const cls = classifySentence(sentence)
      if (cls.kind === 'no-effect') {
        stats.skippedNoEffect += 1
        continue
      }
      if (cls.kind === 'none') continue

      const candidateIds = [...new Set(foreign.map((f) => f.drugId))]
      const candidateNames = [...new Set(foreign.map((f) => f.genericName))]
      const key = `${manual.drugId}|${candidateIds.slice().sort().join(',')}|${sentence}`
      if (seen.has(key)) {
        stats.duplicateQuotes += 1
        continue
      }
      seen.add(key)

      candidates.push({
        sourceInsertId: manual.insertId,
        sourceDrugId: manual.drugId,
        sourceGenericName: sourceNormalized,
        version: manual.version,
        sectionKey,
        quote: sentence,
        aliases: [...new Set(foreign.map((f) => f.alias))],
        candidateDrugIds: candidateIds,
        candidateGenericNames: candidateNames,
        ambiguous: candidateIds.length > 1 || new Set(candidateNames).size > 1,
        aliasKind: foreign.some((f) => f.kind === 'full') ? 'full' : 'stripped',
        level: suggestLevel(sentence),
        markers: { risk: cls.hitRisk, noEffect: cls.hitNoEffect },
      })
    }
  }

  stats.candidates = candidates.length
  return { candidates, stats }
}

/** 逐字自检：quote 必须出现在来源段落里（normalize 后比较）。 */
export function verifyCandidates(candidates: RuleCandidate[], manuals: SourceManual[]): string[] {
  const byId = new Map(manuals.map((m) => [m.insertId, m]))
  const errors: string[] = []
  for (const c of candidates) {
    const manual = byId.get(c.sourceInsertId)
    if (!manual) {
      errors.push(`候选来源不存在：${c.sourceInsertId}`)
      continue
    }
    const section = manual.sections[c.sectionKey] ?? ''
    if (!section.includes(c.quote)) {
      errors.push(`quote 非原文逐字子串：${c.sourceDrugId} / ${c.quote.slice(0, 40)}`)
    }
  }
  return errors
}
