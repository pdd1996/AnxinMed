/**
 * 资产域身份指纹（2026-10-24）——导入脚本与一次性回填共用。
 *
 * 设计：
 * - identityKey = 通用名+规格+剂型+厂家+主批准文号 的稳定哈希（产品级去重）；
 *   分包装企业、分包装批号只做元数据，不进指纹——它们常缺失/多源不一致，进指纹会把同产品拆成多条。
 * - genericId   = 通用名+剂型 的稳定哈希（通用名层）；
 * - sourceDocId = PDF 文件哈希（优先）或规范化正文哈希（来源文档层）。
 */
import { createHash } from 'node:crypto'
import { PRODUCT_TYPES } from './schema.js'

export type ProductType = (typeof PRODUCT_TYPES)[number]

export interface IdentityInput {
  genericName: string
  specification: string
  form: string
  manufacturer?: string | null
  repackager?: string | null
  approvalNumbers?: string[] | null
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

export const normKey = (value: string | null | undefined): string =>
  String(value ?? '').replace(/\s+/g, '').toLowerCase()

const CN_UNIT_MAP: Record<string, string> = {
  千克: 'kg', 公斤: 'kg', 毫克: 'mg', 微克: 'ug', 克: 'g', 毫升: 'ml', 升: 'l',
  毫摩尔: 'mmol', 微摩尔: 'umol', 摩尔: 'mol', 万单位: '万iu', 国际单位: 'iu', 单位: 'iu',
}
const CN_UNIT_PATTERN = '千克|公斤|毫克|微克|毫升|毫摩尔|微摩尔|万单位|国际单位|摩尔|克|升|单位'

function toHalfWidth(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/[【〔]/g, '(')
    .replace(/[】〕]/g, ')')
}

/**
 * 规格归一化：全角标点、中文计量单位、小数点尾零统一后再做指纹。
 * 只用于身份指纹，不改变入库展示的 specification。
 * 例：0.65克 / 0.65 g → 0.65g；5微克 / 5μg / 5mcg → 5ug。
 */
export function normalizeSpecification(value: string | null | undefined): string {
  let s = toHalfWidth(String(value ?? '')).toLowerCase()
  s = s.replace(/[μµ]/g, 'u').replace(/mcg/g, 'ug')
  s = s.replace(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${CN_UNIT_PATTERN})`, 'g'),
    (_match, num: string, unit: string) => num + CN_UNIT_MAP[unit],
  )
  s = s.replace(
    /毫克|微克|毫升|千克|公斤|毫摩尔|微摩尔|万单位|国际单位/g,
    (unit) => CN_UNIT_MAP[unit],
  )
  // 单字单位只在斜杠后替换，避免误伤「克霉唑」「升压」等名称
  s = s.replace(/\/(摩尔|克|升|单位)/g, (_match, unit: string) => '/' + CN_UNIT_MAP[unit])
  s = s.replace(/(\d+\.\d+)/g, (num) => num.replace(/0+$/, '').replace(/\.$/, ''))
  s = s.replace(/[~–—−]/g, '-')
  return s.replace(/\s+/g, '')
}

export function makeIdentityKey(d: IdentityInput): string {
  const approvals = d.approvalNumbers ?? []
  const primaryApproval = approvals.find((a) => !a.includes('分包装')) ?? approvals[0] ?? ''
  return sha256([
    normKey(d.genericName),
    normalizeSpecification(d.specification),
    normKey(d.form),
    normKey(d.manufacturer ?? ''),
    normKey(primaryApproval),
  ].join('|'))
}

export function makeGenericId(d: Pick<IdentityInput, 'genericName' | 'form'>): string {
  return `dg-${sha256([d.genericName, d.form].map(normKey).join('|')).slice(0, 16)}`
}

export function makeSourceDocumentId(
  d: { sourceFileHash?: string | null },
  contentHash: string,
): string {
  return `sd-${sha256(d.sourceFileHash ?? contentHash).slice(0, 16)}`
}

/** 规范化正文哈希（草稿没带 contentHash 时兜底；只对顶层段名排序）。 */
export function fallbackContentHash(sections: Record<string, string>): string {
  return sha256(JSON.stringify(sections, Object.keys(sections).sort()))
}

/** 产品类型推断：有批准文号前缀优先，中药材/器械按名称兜底；无法判断返回 null。 */
export function inferProductType(
  genericName: string,
  form: string | null,
  approvals: string[],
): ProductType | null {
  if (form === '中药材') return '中药材'
  if (genericName.includes('械')) return '医疗器械'
  const joined = approvals.join(' ')
  if (joined.includes('国药准字Z') || joined.includes('国药准字B')) return '中成药'
  if (joined.includes('国药准字S')) return '生物制品'
  if (joined) return '化学药'
  return null
}
