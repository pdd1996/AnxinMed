/**
 * 过敏确定性覆盖层（M4-T4 · specs/04-T4，裁决 #3）——零 LLM，纯函数。
 *
 * 机制：档案「过敏史」关键词 ∩ 对象药禁忌段文本 命中 → sections.risks 追加固定警示条目
 * + citations 追加禁忌段引用；未命中 → 原样返回。**不经模型、不改 riskLevel、不进 risk_events**
 * （提示非拦截，与相互作用注入同构；allergy 不做模型上下文联想——交叉过敏推断风险最高，
 * 确定性交集是唯一可信路径）。
 *
 * 位置纪律：调用方（consult.service）只在 S1 管线输出后（answered / limited / manual-gate，
 * 已归一化）附加；S0 守门文案与 S2 数据直答不附加（无禁忌段上下文或非说明书回答）。
 *
 * ⚠️ 匹配口径（宁漏勿误向确定性倾斜）：
 * - 过敏词先归一化（去「对」前缀 /「过敏」「史」后缀取核心词，如「对青霉素过敏」→「青霉素」），
 *   核心词长度 ≥2（单字误报率不可控）；
 * - 命中判定 = 禁忌段文本包含核心词（大小写不敏感，兼容拉丁药名）；
 * - 漏判 = 少一条提示（非拦截层，安全侧）；误判 = 多一条提示（骚扰但无害）——不做模糊联想，
 *   精确子串是唯一规则。
 */
import { sanitizeText } from './sanitize.js'
import type { Citation, NormalizedSections } from './types.js'

/** health_profiles 过敏字段键（PRD §7.1.2 健康信息字段，fieldKey 用中文标签）。 */
export const ALLERGY_FIELD_KEY = '过敏史'

/** 覆盖层固定警示前缀（命中时追加进 sections.risks 的唯一条目形态）。 */
const ALLERGY_WARNING_PREFIX = '过敏警示'

/**
 * jsonb 禁忌段窄化为可匹配文本：string[] → "a；b"；string → 原样；null/其他 → 空串。
 * 与 sections.ts joinJsonArray 同口径，独立实现避免私有函数跨文件泄漏。
 */
function narrowContraindications(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => sanitizeText(x)).filter(Boolean).join('；')
  if (typeof v === 'string') return sanitizeText(v)
  return ''
}

/**
 * 过敏值归一化：去「对」前缀与「过敏」「史」后缀取核心词。
 * 「对青霉素过敏」→「青霉素」；「磺胺」→「磺胺」；「青霉素史」→「青霉素」。
 */
export function normalizeAllergyToken(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^对/, '')
    .replace(/(过敏|史)$/, '')
    .trim()
}

/**
 * 从 health_profiles 行提取过敏关键词（白名单只读：只取 ALLERGY_FIELD_KEY 字段，
 * 其余档案字段一律不进咨询链路）。多词值按中英文分隔符拆分，归一化去重，核心词 ≥2 字保留。
 */
export function extractAllergyKeywords(rows: Array<{ fieldKey: string; value: string | null }>): string[] {
  const out: string[] = []
  for (const row of rows) {
    if (row.fieldKey !== ALLERGY_FIELD_KEY) continue
    const tokens = String(row.value ?? '')
      .split(/[,，、;；/\s]+/)
      .map(normalizeAllergyToken)
      .filter((t) => t.length >= 2)
    out.push(...tokens)
  }
  return [...new Set(out)]
}

/**
 * 过敏覆盖层（纯函数）：过敏关键词 ∩ 禁忌段。
 *
 * @param allergyKeywords extractAllergyKeywords 产物（已归一化）
 * @param contraindications package_inserts.contraindications（jsonb：string[] | string | null）
 * @param sections S1 管线归一化后的回答分区
 * @param citations S1 管线组装的回答引用（非空——S1 各路径均携带 insert 三件套）
 * @returns 命中 → { sections, citations } 为追加后的新对象（原对象不变）；未命中 / 禁忌段缺失 /
 *          无关键词 / citations 为空（引用溯源无从附加，防御性跳过）→ 原样返回（同一引用）
 */
export function allergyOverlay(
  allergyKeywords: string[],
  contraindications: unknown,
  sections: NormalizedSections,
  citations: Citation[],
): { sections: NormalizedSections; citations: Citation[] } {
  if (allergyKeywords.length === 0 || citations.length === 0) {
    return { sections, citations }
  }
  const contraText = narrowContraindications(contraindications)
  if (!contraText) return { sections, citations }

  const matched = allergyKeywords.filter((k) => contraText.toLowerCase().includes(k.toLowerCase()))
  if (matched.length === 0) return { sections, citations }

  // 固定警示条目（单条；matched 全列出）。追加在归一化后的 risks 之后（可超 LLM 输出的 ≤3 约束——
  // 安全覆盖层不裁剪，前端列表自然渲染）。
  const warning = `${ALLERGY_WARNING_PREFIX}：你的档案过敏信息（${matched.join('、')}）与该药禁忌相关，请核对禁忌并咨询医生或药师。`
  // 禁忌段引用：克隆基础三件套（S1 路径 citations[0] 即对象药 insert 引用）+ sectionLabel 标记
  const sectionCitation: Citation = { ...citations[0], sectionLabel: '禁忌' }

  return {
    sections: { ...sections, risks: [...sections.risks, warning] },
    citations: [...citations, sectionCitation],
  }
}
