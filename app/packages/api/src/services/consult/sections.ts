/**
 * 说明书按键取数（M3-T1 · PRD §7.5.4）——从 demo/server/index.js 迁移。
 *
 * 三个纯函数：
 * - `pickInsertSections(question, insert)`：按问题类型路由到说明书对应段落（结构化取数优先于语义检索）；
 * - `normalizeSections(raw, context)`：LLM 输出归一化（stripDosageAdvice 过滤剂量 + 兜底文案）；
 * - `fallbackSectionsFromInsert(question, insert)`：Baichuan 不可用时的规则降级拼装。
 *
 * ⚠️ jsonb 列（contraindications / precautions）形态不定：可能是 string[] / string / null；
 *    统一走 `joinJsonArray` 窄化为可读文本，避免 LLM prompt 里出现 `[object Object]`。
 */
import { SECTION_ROUTES } from './patterns.js'
import { containsDosageAdvice, sanitizeText, stripDosageAdvice } from './sanitize.js'
import type { ConsultRawSections, InsertSlice, NormalizedSections } from './types.js'

/** jsonb 列窄化：string[] → "a；b"；string → 原样；null/其他 → 空串。 */
function joinJsonArray(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => sanitizeText(x)).filter(Boolean).join('；')
  if (typeof v === 'string') return sanitizeText(v)
  return ''
}

/** 段落取数产物：label 供 prompt 与前端展示，text 为拼装后的段落正文。 */
export interface PickedSection {
  key: string
  label: string
  text: string
}

/**
 * 按问题类型取说明书对应段落（PRD §7.5.4：结构化取数优先于语义检索）。
 * 按 SECTION_ROUTES 顺序短路匹配；兜底为适应症段。
 */
export function pickInsertSections(question: string, insert: InsertSlice): PickedSection {
  const q = String(question ?? '')
  const route = SECTION_ROUTES.find((r) => !r.re || r.re.test(q)) ?? SECTION_ROUTES[SECTION_ROUTES.length - 1]

  const text = buildSectionText(route.key, insert)
  return { key: route.key, label: route.label, text }
}

/**
 * 频率表特征（**M7 起仅保留作诊断用，不再进 prompt**）。
 *
 * M6 曾用它在 prompt 里禁止「反应 ↔ 频率档位」归属（表格被文本层拉平的临时防线）；
 * M7 已在提取器层重建表格行列（Markdown 表），防线撤除——正常表格与段落式分频率
 * 叙述都能被模型按结构读取，继续禁用会把「十分常见/常见」等档位的正确引用一并禁掉。
 * 保留此函数供抽检/质量扫描判断「段落是否仍呈拉平形态」。
 */
export function hasFrequencyTable(text: string): boolean {
  const t = String(text ?? '')
  if (/系统器官分类/.test(t) && /(十分常见|常见)/.test(t)) return true
  return /十分常见[\s\S]{0,80}常见[\s\S]{0,160}(?:偶见|罕见)/.test(t)
}

/** source_sections 取原文（支持 PDF/DXY 段名变体）；未收录返回空串。 */
function sourceText(insert: InsertSlice, keys: string[]): string {
  const sections = insert.sourceSections ?? {}
  for (const key of keys) {
    const text = sections[key]
    if (text) return sanitizeText(text)
  }
  return ''
}

/** 按段落 key 从说明书切片拼正文（未收录字段明确标注，避免 LLM 幻觉填空）。 */
function buildSectionText(key: string, insert: InsertSlice): string {
  const contra = joinJsonArray(insert.contraindications)
  const preca = joinJsonArray(insert.precautions)

  switch (key) {
    case 'pharmacology':
      return `药理作用：${insert.pharmacology || '（未收录）'}；药代动力学：${insert.pharmacokinetics || '（未收录）'}`
    case 'interactions':
      return `相互作用：${insert.interactions || '（未收录）'}`
    case 'adverse':
      return `不良反应：${insert.adverseReactions || '（未收录）'}`
    case 'contraindication':
      return `禁忌：${contra || '（未收录）'}`
    case 'components':
      return `成份：${insert.components || '（未收录）'}`
    case 'pregnancy':
      return `孕妇及哺乳期用药：${sourceText(insert, ['孕妇和哺乳期妇女用药', '孕妇用药', '哺乳期妇女用药']) || '（未收录）'}`
    case 'pediatric':
      return `儿童用药：${sourceText(insert, ['儿童用药']) || '（未收录）'}`
    case 'geriatric':
      return `老年用药：${sourceText(insert, ['老年用药']) || '（未收录）'}`
    case 'overdose':
      return `药物过量：${sourceText(insert, ['药物过量']) || '（未收录）'}`
    case 'precautions':
      return `注意事项：${preca || '（未收录）'}`
    case 'storage':
      return `储存：${insert.storage || preca || '请按包装和说明书要求保存'}`
    case 'dosage':
      // 医嘱范畴：本助手不提供具体剂量/频次/疗程数字（PRD §7.5.3 L2 前置防线）
      return '用法用量属于医嘱范畴，本助手不提供具体剂量、频次、疗程数字，请按医生处方或药师指导执行。'
    case 'indication':
    default:
      return `适应症：${insert.indication || '（未收录）'}`
  }
}

/** normalizeSections 的兜底上下文（LLM 输出缺项时用说明书规则填补）。 */
export interface NormalizeContext {
  summaryFallback?: string
  keyPointsFallback?: string[]
  risksFallback?: string[]
}

/**
 * LLM 输出归一化：stripDosageAdvice 过滤剂量 + 兜底文案 + limited 标记。
 * `limited=true` 时 run.ts 将 riskLevel 升为 L2、status 置 'limited'、附固定提示语。
 */
export function normalizeSections(raw: ConsultRawSections | null, context: NormalizeContext = {}): NormalizedSections {
  const summary = stripDosageAdvice(raw?.summary)
  const keyPoints = (Array.isArray(raw?.keyPoints) ? raw.keyPoints : [])
    .slice(0, 3)
    .map((s: string) => stripDosageAdvice(s))
    .filter(Boolean)
  const risks = (Array.isArray(raw?.risks) ? raw.risks : [])
    .slice(0, 3)
    .map((s: string) => sanitizeText(s))
    .filter(Boolean)
  const nextActionRaw = sanitizeText(raw?.nextAction || '如有疑问，请咨询医生或药师。')
  const warning = sanitizeText(raw?.warning || '不要根据 AI 回答自行调整处方。')
  const limited = [summary, ...keyPoints, nextActionRaw].some(containsDosageAdvice)

  return {
    summary: summary || context.summaryFallback || '暂时无法给出确定结论，请查看药品说明书或咨询医生、药师。',
    keyPoints: keyPoints.length ? keyPoints : context.keyPointsFallback ?? [],
    risks: risks.length ? risks : context.risksFallback ?? [],
    nextAction: limited ? '具体用量和疗程请按医生处方或说明书执行。' : nextActionRaw,
    warning,
    limited,
  }
}

// ---------------------------------------------------------------------------
// L0/降级回答的排版与简化（2026-11-20 用户要求：优化排版、简化文字）
//
// 背景：未核验说明书的注意事项常被抽成「单元素整段」（可达 1000+ 字），
// 直接塞进卡片就是一大堵文字墙（见 M6/M7 抽取形态）。这里只做**展示层整理**：
// - 合并 PDF 硬折行产生的词内换行，避免「乙型流 感」这类断词；
// - 短摘要省略长括注（原文全部保留在 details 展开区）；
// - 注意事项按行首编号拆条，摘要只取前 3 条、每条截到首句/两句；
// - 完整段落与逐条原文收进 details（前端「展开原文」）。
// 不生成、不改写医学内容；原文始终可在展开区逐字核对。
// ---------------------------------------------------------------------------

/** 中日韩文字与全角标点（含中文标点区、全角字符区）。 */
const CJK_RE = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/

/** 合并 PDF 硬折行：中文字符之间的换行直接拼接，其余换行归一为空格。 */
export function normalizeLeafletText(text: unknown): string {
  const raw = String(text ?? '').replace(/\r/g, '')
  const joined = raw.replace(/\n+/g, (match: string, offset: number, whole: string) => {
    const prev = whole[offset - 1] ?? ''
    const next = whole[offset + match.length] ?? ''
    return CJK_RE.test(prev) || CJK_RE.test(next) ? '' : ' '
  })
  return joined
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([，。；！？、：）】》])/g, '$1')
    .replace(/([（【《])\s+/g, '$1')
    .trim()
}

/** 短摘要里省略长括注（≥10 字）；短括注（如「（75mg）」）保留。 */
function stripLongParentheticals(text: string): string {
  return text.replace(/[（(][^（）()]{10,}[）)]/g, '')
}

/** 取前若干整句（尽量不截断句子）；仍有剩余时补省略号。 */
function firstSentences(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const parts = t.match(/[^。！？；]*[。！？；]?/g)?.map((s) => s.trim()).filter(Boolean) ?? []
  let out = ''
  for (const part of parts) {
    if (out && out.length + part.length > max) break
    if (!out && part.length > max) return `${part.slice(0, max - 1)}…`
    out += part
  }
  if (!out) return `${t.slice(0, max - 1)}…`
  return out.length < t.length ? `${out}…` : out
}

/** 去掉条目前的编号（「·1.」「●2.」「3.」「（4）」等）。 */
function stripItemNumber(text: string): string {
  return text.replace(/^\s*(?:[·●•○]\s*)?\d{1,2}\s*[.、．)）]\s*/, '')
}

/**
 * jsonb 注意事项 → 条目数组：兼容单元素整段（跨行）与已拆条数组，
 * 按行首编号拆分；拆不出来时整段作为一条。
 */
function splitLeafletItems(value: unknown): string[] {
  const chunks = Array.isArray(value)
    ? value.map((v) => String(v ?? '')).filter(Boolean)
    : typeof value === 'string'
      ? [value]
      : []
  const items: string[] = []
  for (const chunk of chunks) {
    const raw = chunk.replace(/\r/g, '').trim()
    if (!raw) continue
    let parts = raw.split(/\n(?=\s*(?:[·●•○]\s*)?\d{1,2}\s*[.、．)）])/)
    // 兜底：编号与内容在同一行、仅用分隔符排开时，按编号再次拆分
    if (parts.length === 1 && (raw.match(/[·●•○]\s*\d{1,2}\s*[.、．]/g) ?? []).length > 1) {
      parts = raw.split(/(?=[·●•○]\s*\d{1,2}\s*[.、．])/)
    }
    for (const part of parts) {
      const item = stripItemNumber(normalizeLeafletText(part))
      if (item) items.push(item)
    }
  }
  return items
}

/** 说明书段落 → 短摘要（去长括注 + 去句首编号 + 截首句）。 */
export function digestSectionText(text: string, max = 90): string {
  const t = stripLongParentheticals(normalizeLeafletText(text)).replace(
    /(^|[。；！？])\s*\d{1,2}\s*[.、．]\s*/g,
    '$1',
  )
  return firstSentences(t, max)
}

/** 注意事项单条 → 短要点（去编号 + 长括注 + 截首句）。 */
function digestLeafletItem(text: string, max = 64): string {
  return firstSentences(stripLongParentheticals(stripItemNumber(text)), max)
}

/** 禁忌等短段落 → 短要点。 */
export function digestShortText(text: unknown, max = 50): string {
  return firstSentences(stripLongParentheticals(normalizeLeafletText(text)), max)
}

/**
 * 说明书原文的「下一步」：命中严重警示关键词时给即时就医提示（P2，2026-11-20）；
 * 否则回到通用「问医生/药师」。只加固定安全语，不生成个体化建议。
 */
export function leafletNextAction(texts: string[]): string {
  const joined = texts.join(' ')
  if (/致命|精神神经|谵妄|惊厥|幻觉|行为异常|严重过敏|过敏性休克|呼吸困难|立即就医/.test(joined)) {
    return '如出现幻觉、谵妄、行为异常、严重过敏或呼吸困难等，请立即就医；用药调整请咨询医生或药师。'
  }
  return '具体是否适用、用法用量及疗程请咨询医生或药师。'
}

/**
 * Baichuan 不可用/L0 资料查询时的降级路径：用说明书段落拼装确定性回答（不依赖 LLM）。
 * 卡片只放短摘要，完整原文放 details 展开区；status 由调用方决定。
 */
export function fallbackSectionsFromInsert(question: string, insert: InsertSlice): NormalizedSections {
  const section = pickInsertSections(question, insert)
  const sectionText = section.text.replace(/^[^：:]+[：:]/, '')
  const precautionItems = splitLeafletItems(insert.precautions)
  const contraItems = Array.isArray(insert.contraindications)
    ? insert.contraindications.map(String)
    : typeof insert.contraindications === 'string'
      ? [insert.contraindications]
      : []

  const sections = normalizeSections(
    {
      summary: digestSectionText(sectionText, 90),
      keyPoints: precautionItems.slice(0, 3).map((item) => digestLeafletItem(item, 64)),
      risks: contraItems.slice(0, 2).map((item) => digestShortText(item, 50)),
      nextAction: leafletNextAction([sectionText, ...precautionItems.slice(0, 3), ...contraItems]),
      warning: '不要根据 AI 回答自行调整处方。',
    },
    {
      summaryFallback: `${insert.genericName}的资料请以说明书为准。`,
      keyPointsFallback: insert.indication ? [digestSectionText(insert.indication, 90)] : [],
      risksFallback: contraItems.slice(0, 2).map((item) => digestShortText(item, 50)),
    },
  )

  // 展开原文：所选段落全文 + 注意事项逐条原文（选中的就是注意事项时只保留逐条，避免重复）
  const details: Array<{ title: string; body: string; source?: string }> = []
  const sectionBody = normalizeLeafletText(sectionText)
  if (sectionBody && section.key !== 'precautions') {
    details.push({ title: `${section.label}（原文）`, body: sectionBody, source: insert.source || undefined })
  }
  precautionItems.forEach((item, index) => {
    details.push({
      title: `注意事项原文 · 第 ${index + 1} 条`,
      body: item,
      source: insert.source || undefined,
    })
  })

  return details.length > 0 ? { ...sections, details } : sections
}
