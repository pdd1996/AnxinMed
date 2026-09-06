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

/**
 * Baichuan 不可用时的降级路径：直接用说明书段落拼装确定性回答（不依赖 LLM）。
 * 与 demo fallbackSectionsFromInsert 等价；status='answered' 但附 notice 说明是降级。
 */
export function fallbackSectionsFromInsert(question: string, insert: InsertSlice): NormalizedSections {
  const section = pickInsertSections(question, insert)
  return normalizeSections(
    {
      summary: section.text.replace(/^[^：:]+[：:]/, '').slice(0, 120),
      keyPoints: (Array.isArray(insert.precautions) ? insert.precautions : []).slice(0, 2).map((s: unknown) => sanitizeText(s)),
      risks: (Array.isArray(insert.contraindications) ? insert.contraindications : []).slice(0, 2).map((s: unknown) => sanitizeText(s)),
      nextAction: '如有疑问，请咨询医生或药师。',
      warning: '不要根据 AI 回答自行调整处方。',
    },
    {
      summaryFallback: `${insert.genericName}的资料请以说明书为准。`,
      keyPointsFallback: insert.indication ? [sanitizeText(insert.indication)] : [],
      risksFallback: (Array.isArray(insert.contraindications) ? insert.contraindications : []).slice(0, 2).map((s: unknown) => sanitizeText(s)),
    },
  )
}
