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

export function makeIdentityKey(d: IdentityInput): string {
  const approvals = d.approvalNumbers ?? []
  const primaryApproval = approvals.find((a) => !a.includes('分包装')) ?? approvals[0] ?? ''
  return sha256([
    d.genericName,
    d.specification,
    d.form,
    d.manufacturer ?? '',
    primaryApproval,
  ].map(normKey).join('|'))
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
