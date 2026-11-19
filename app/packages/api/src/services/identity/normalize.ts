/**
 * 身份线匹配原语（M2-T4 · PRD §8.2）——照搬 demo/server/index.js 已验证逻辑（normalize /
 * parseStrengthTokens / tokensOverlap / nameMatches / formMatches），升级为 TS 纯函数。
 *
 * 三项严格匹配的比对基础：药名（归一化双向子串）、规格（解析成 {value,unit} 再比，
 * 优先 % 浓度、其次质量统一换算 mg，体积 mL 不作为 potency）、剂型（缺则不阻塞）。
 */
import { toHalfWidth } from '../sanitize/normalize.js'

/** 归一：全角转半角 → 去空白/乘号(×xX*) → 转小写。名称/规格/剂型比对统一先过此函数（demo normalize + 全半角容错）。 */
export function normalizeToken(value: string): string {
  return toHalfWidth(value).replace(/[\s×x*]/gi, '').toLowerCase()
}

/**
 * 批准文号比对键：全角转半角 → 去空白 → 转大写，**不剥离 x/X**（进口注册证号常以 X 开头，
 * 用 normalizeToken 会误删）。批准文号是平局裁判，比对必须精确。
 */
export function approvalKey(value: string): string {
  return toHalfWidth(value).replace(/\s+/g, '').toUpperCase()
}

/** 规格强度 token：% 浓度列表 + 质量列表（统一换算为 mg）。 */
export interface StrengthTokens {
  pct: number[]
  mg: number[]
}

/**
 * 规格解析（照搬 demo parseStrengthTokens）：优先 % 浓度，其次质量（g→mg×1000、μg→mg÷1000）。
 * 体积 mL 不作为 potency（"0.1%（10mL:10mg）" 拆出 pct=0.1、mg=10）。
 */
export function parseStrengthTokens(spec: string): StrengthTokens {
  const s = normalizeToken(spec)
  const tokens: StrengthTokens = { pct: [], mg: [] }
  const pct = s.match(/([\d.]+)%/)
  if (pct) tokens.pct.push(Number(pct[1]))
  for (const m of s.matchAll(/([\d.]+)(mg|毫克|g|克|μg)/gi)) {
    const value = Number(m[1])
    const unit = m[2].toLowerCase()
    tokens.mg.push(unit === 'g' || unit === '克' ? value * 1000 : unit === 'μg' ? value / 1000 : value)
  }
  return tokens
}

/** 规格是否有可比强度信息（% 或质量任一非空）。 */
export function hasStrength(tokens: StrengthTokens): boolean {
  return tokens.pct.length > 0 || tokens.mg.length > 0
}

/**
 * 规格强度重叠（照搬 demo tokensOverlap）：两侧都有 % → 只比 %；否则 % 或 mg 任一重叠即算。
 * mg 用 <0.001 容差避免浮点误差；% 精确相等。
 */
export function strengthOverlap(a: StrengthTokens, b: StrengthTokens): boolean {
  const pctOverlap = a.pct.length > 0 && b.pct.length > 0 && a.pct.some((v) => b.pct.includes(v))
  const mgOverlap =
    a.mg.length > 0 && b.mg.length > 0 && a.mg.some((v) => b.mg.some((w) => Math.abs(v - w) < 0.001))
  if (a.pct.length > 0 && b.pct.length > 0) return pctOverlap
  return pctOverlap || mgOverlap
}

/** 药名匹配（照搬 demo nameMatches）：归一后双向子串（"苯磺酸氨氯地平" ⊂ "苯磺酸氨氯地平片"）。 */
export function nameMatches(a: string, b: string): boolean {
  const na = normalizeToken(a)
  const nb = normalizeToken(b)
  return Boolean(na && nb && (na.includes(nb) || nb.includes(na)))
}

/**
 * 剂型英文/别名词表（2026-11-19 现场实测补）：真实药盒正面常印英文剂型（如 `Allisartan Isoproxil
 * Tablets`），VLM 可能把 form 抄成 `Tablets`；而库内 dish 型是中文「片」。逐字比对会误报「剂型冲突」，
 * 演示现场就是被这个卡住（提取 Tablets vs 库 片）。这里把英文/常见别名归一到中文基形，再走双向子串比对。
 * 顺序有意义：长词在前（eyedrop 先于 drop、injection 先于 drop 等）。
 */
const FORM_SYNONYMS: ReadonlyArray<readonly [needle: string, canonical: string]> = [
  ['eyedrop', '滴眼液'],
  ['eardrop', '滴耳液'],
  ['nasalspray', '鼻喷剂'],
  ['tablet', '片'],
  ['capsul', '胶囊'],
  ['granul', '颗粒'],
  ['inject', '注射液'],
  ['infusion', '输液'],
  ['suppositor', '栓剂'],
  ['ointment', '软膏'],
  ['cream', '乳膏'],
  ['lotion', '洗剂'],
  ['liniment', '搽剂'],
  ['tincture', '酊剂'],
  ['suspension', '混悬剂'],
  ['emulsion', '乳剂'],
  ['solution', '溶液剂'],
  ['syrup', '糖浆'],
  ['powder', '散剂'],
  ['patch', '贴剂'],
  ['aerosol', '气雾剂'],
  ['inhal', '吸入剂'],
  ['lozenge', '含片'],
  ['granule', '颗粒'],
  ['pill', '丸'],
  ['drop', '滴剂'],
  ['spray', '喷雾剂'],
  ['gel', '凝胶'],
  ['film', '膜剂'],
]

/** 剂型归一：英文/别名 → 中文基形；已是中文的（片/片剂/滴眼液…）原样返回，靠双向子串兼容。 */
export function canonicalForm(form: string | null | undefined): string {
  const t = normalizeToken(String(form ?? ''))
  if (!t) return ''
  for (const [needle, canonical] of FORM_SYNONYMS) {
    if (t.includes(needle)) return canonical
  }
  return t
}

/** 剂型匹配（照搬 demo formMatches）：identity 缺剂型 → 不阻塞（true）；否则归一后双向子串。 */
export function formMatches(identityForm: string | undefined, drugForm: string): boolean {
  if (!identityForm) return true
  const a = canonicalForm(identityForm)
  const b = canonicalForm(drugForm)
  return Boolean(a && b && (b.includes(a) || a.includes(b)))
}

// ── 多规格合并判定（2026-11-19 身份展示止血）────────────────────────────────

/** 规格强度的度量类：只有同类数值才可能是"并列的多个规格"。 */
function strengthClass(unit: string): 'mass' | 'volume' | 'pct' | 'potency' | 'other' {
  const u = unit.toLowerCase()
  if (u === '%') return 'pct'
  if (['mg', '毫克', 'g', '克', 'μg', 'ug'].includes(u)) return 'mass'
  if (['ml', '毫升'].includes(u)) return 'volume'
  if (u === 'iu' || u.includes('国际单位')) return 'potency'
  return 'other'
}

/** 单个"纯强度"片段：`80mg` / `0.15g` / `2ml` / `0.1%`（前后可有枚举序号）。 */
const PURE_STRENGTH_RE = /^[①②③④⑤⑥⑦⑧⑨⑩]?(\d+(?:\.\d+)?)(mg|毫克|g|克|μg|ug|ml|毫升|%|万国际单位|国际单位|iu)$/i

/** 规格文本里出现的任一强度 token（仅用于"枚举式多规格"计数）。 */
const ANY_STRENGTH_RE = /(\d+(?:\.\d+)?)(mg|毫克|g|克|μg|ug|ml|毫升|%|万国际单位|国际单位|iu)/gi

/**
 * 判断一条库条目的规格文本是否为**多个规格被合并成一行**（PDF 抽取常见）。
 *
 * 背景（2026-11-19）：全库 1588 行 drug_master 均为 crawled（未人工核对），其中一批是
 * 「一行 = 多个规格」的合并条目（如 `80mg，240mg`，其批准文号其实是两个：80mg=H…001、
 * 240mg=H…002）。这类条目按 token 重叠会误判成"唯一匹配"，并把某一规格的批准文号配给另一个规格。
 * 因此身份线必须先识别它们，禁止判 unique（降级为让用户按实物规格选择/手动建档）。
 *
 * 判定口径（保守、宁可漏判不可误判为多规格）：
 *   ① 逗号/顿号/分号并列的「纯强度」片段 ≥2 且存在同类（如 `80mg，240mg`、`75mg，0.15g`、`1mg、2mg`）；
 *   ② 斜杠并列且两侧同类（如 `80mg/240mg`）——`10万IU/20g/支` 这类单规格配比两侧不同类，不判；
 *   ③ 枚举标记 ≥2 且强度 ≥2（如 `1）50mg 2）200mg`、`①2ml②5ml`）。
 * 括号内容先整体剔除（多为单规格的组成/装量说明，如 `0.1%（10mL:10mg）`）。
 */
export function hasMultiStrengthSpec(specification: string | null | undefined): boolean {
  if (!specification) return false
  const withoutParens = toHalfWidth(String(specification)).replace(/[（(][^）)]*[）)]/g, '')
  const s = withoutParens.replace(/[\s×*]/g, '')
  if (!s) return false

  // ① 纯强度片段并列（同度量类才可能是"多个规格"）
  const pureClasses = s
    .split(/[，,、；;]/)
    .map((seg) => PURE_STRENGTH_RE.exec(seg))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => strengthClass(m[2]))
  if (pureClasses.length >= 2 && new Set(pureClasses).size < pureClasses.length) return true

  // ② 斜杠并列的同类强度对（80mg/240mg）
  const slash = /^(\d+(?:\.\d+)?)(mg|毫克|g|克|μg|ug|ml|毫升|%)\/(\d+(?:\.\d+)?)(mg|毫克|g|克|μg|ug|ml|毫升|%)$/i.exec(s)
  if (slash && strengthClass(slash[2]) === strengthClass(slash[4])) return true

  // ③ 枚举式多规格（1）50mg 2）200mg ／ ①2ml②5ml③10ml）
  const markerCount = (s.match(/[①②③④⑤⑥⑦⑧⑨⑩]|[（(]?[1-9][）)]/g) ?? []).length
  const strengthCount = (s.match(ANY_STRENGTH_RE) ?? []).length
  return markerCount >= 2 && strengthCount >= 2
}
