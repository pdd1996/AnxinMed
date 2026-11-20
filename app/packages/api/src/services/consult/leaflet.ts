/**
 * 说明书分段落视图（2026-11-20）——咨询卡「查看完整说明书」入口与独立分段落页共用。
 *
 * 数据源优先级：`sourceSections`（PDF 原文分段，逐字）→ typed 字段（旧行/非 PDF 来源兜底）。
 * 用法用量段固定为「医嘱范畴」提示（PRD §7.5.3：不提供具体剂量/频次/疗程数字）；
 * 其余段落只做折行归一（中文字符间换行拼接），不摘要、不改写。
 */

import { normalizeLeafletText } from './sections.js'
import type { InsertSlice } from './types.js'

export interface LeafletSectionView {
  key: string
  title: string
  body: string
}

export interface LeafletView {
  sections: LeafletSectionView[]
  /** 未人工核验时的固定提示；已核验为 null。 */
  notice: string | null
}

/** 用法用量固定提示（不含任何剂量数字，白名单口径同 pickInsertSections dosage）。 */
export const DOSAGE_NOTICE =
  '用法用量属于医嘱范畴，本助手不提供具体剂量、频次、疗程数字，请按医生处方或药师指导执行。'

/** 未核验说明书的分段页提示。 */
export const LEAFLET_UNVERIFIED_NOTICE =
  '该说明书尚未人工核验，以下为原文摘录，请以药品包装内说明书为准。'

/** 标准分段顺序（标题即页面上的段落名）。 */
const SECTION_ORDER: Array<{ key: string; sourceKey: string }> = [
  { key: 'indication', sourceKey: '适应症' },
  { key: 'dosage', sourceKey: '用法用量' },
  { key: 'contraindication', sourceKey: '禁忌' },
  { key: 'precautions', sourceKey: '注意事项' },
  { key: 'adverse', sourceKey: '不良反应' },
  { key: 'pediatric', sourceKey: '儿童用药' },
  { key: 'geriatric', sourceKey: '老年用药' },
  { key: 'pregnancy', sourceKey: '孕妇和哺乳期妇女用药' },
  { key: 'interactions', sourceKey: '药物相互作用' },
  { key: 'pharmacology', sourceKey: '药理毒理' },
  { key: 'pharmacokinetics', sourceKey: '药代动力学' },
  { key: 'overdose', sourceKey: '药物过量' },
  { key: 'appearance', sourceKey: '性状' },
  { key: 'components', sourceKey: '成份' },
  { key: 'specification', sourceKey: '规格' },
  { key: 'approval', sourceKey: '批准文号' },
  { key: 'storage', sourceKey: '贮藏' },
  { key: 'shelfLife', sourceKey: '有效期' },
  { key: 'package', sourceKey: '包装' },
  { key: 'manufacturer', sourceKey: '生产企业' },
  { key: 'standard', sourceKey: '执行标准' },
]

/** 说明书全文 → 标准化分段数组（空段丢弃；用法用量恒为固定提示）。 */
export function buildLeafletView(insert: InsertSlice): LeafletView {
  const source = insert.sourceSections ?? {}
  const sections: LeafletSectionView[] = []

  for (const { key, sourceKey } of SECTION_ORDER) {
    if (key === 'dosage') {
      sections.push({ key, title: sourceKey, body: DOSAGE_NOTICE })
      continue
    }
    const raw = source[sourceKey] ?? typedSectionText(key, insert)
    const body = normalizeLeafletText(raw)
    if (body) sections.push({ key, title: sourceKey, body })
  }

  return {
    sections,
    notice: insert.curationStatus === 'reviewed' ? null : LEAFLET_UNVERIFIED_NOTICE,
  }
}

/** typed 字段兜底（source_sections 缺失的旧行 / 非 PDF 来源）。 */
function typedSectionText(key: string, insert: InsertSlice): string {
  switch (key) {
    case 'indication':
      return insert.indication ?? ''
    case 'contraindication':
      return joinUnknown(insert.contraindications)
    case 'precautions':
      return joinUnknown(insert.precautions)
    case 'adverse':
      return insert.adverseReactions ?? ''
    case 'interactions':
      return insert.interactions ?? ''
    case 'pharmacology':
      return insert.pharmacology ?? ''
    case 'pharmacokinetics':
      return insert.pharmacokinetics ?? ''
    case 'storage':
      return insert.storage ?? ''
    case 'components':
      return insert.components ?? ''
    default:
      return ''
  }
}

function joinUnknown(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '')).filter(Boolean).join('\n')
  return typeof value === 'string' ? value : ''
}
