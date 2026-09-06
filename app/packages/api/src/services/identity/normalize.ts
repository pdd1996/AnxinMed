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

/** 剂型匹配（照搬 demo formMatches）：identity 缺剂型 → 不阻塞（true）；否则归一后双向子串。 */
export function formMatches(identityForm: string | undefined, drugForm: string): boolean {
  if (!identityForm) return true
  const a = normalizeToken(identityForm)
  const b = normalizeToken(drugForm)
  return Boolean(a && b && (b.includes(a) || a.includes(b)))
}
