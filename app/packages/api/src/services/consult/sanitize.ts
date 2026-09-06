/**
 * 咨询回答文本清洗（M3-T1 · PRD §7.5.3）——从 demo/server/index.js 迁移。
 *
 * 三个纯函数（零 I/O、确定性）：
 * - `sanitizeText`：抹除 Markdown/引用编号/多余空白（LLM 输出常带 **粗体** 或 ^[1]^）；
 * - `containsDosageAdvice`：DOSAGE_OUTPUT_PATTERN 命中判定（L2 触发条件）；
 * - `stripDosageAdvice`：命中时按中文句读切除含剂量/频次的整句（宁可误杀，不漏放数字）。
 *
 * ⚠️ 单测须覆盖：干净文本不误伤、剂量文本被切除、切除后剩余文案仍可读、边界（空/null）。
 */
import { DOSAGE_OUTPUT_PATTERN } from './patterns.js'

/**
 * 抹除 LLM 输出中的 Markdown 修饰与引用编号，压缩空白。
 * 不改语义，只清洗呈现层噪声。
 */
export function sanitizeText(text: unknown): string {
  return String(text ?? '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\^\[\d+\]\^/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** L2 触发判定：文本是否含具体剂量/频次数字模式。 */
export function containsDosageAdvice(text: unknown): boolean {
  return DOSAGE_OUTPUT_PATTERN.test(String(text ?? ''))
}

/**
 * L2 剂量过滤：命中时按中文句读（。！？）切除包含剂量/频次关键词的整句；未命中原样清洗。
 *
 * 例：
 *   "建议一日3次，每次1片。疗程7天。" → "疗程7天。"（前句被切除）
 *   "该药用于缓解症状。"               → "该药用于缓解症状。"（未命中原样）
 *
 * ⚠️ 保守策略：宁可把整句切掉也不留数字；切除后如为空由调用方兜底文案。
 */
export function stripDosageAdvice(text: unknown): string {
  const raw = String(text ?? '')
  if (!containsDosageAdvice(raw)) return sanitizeText(raw)
  return sanitizeText(raw).replace(
    /[^。！？]*?(?:一日|每天|每次|分\s*\d+\s*次|mg|g|片|粒|滴)[^。！？]*[。！？]?/gi,
    '',
  )
}
