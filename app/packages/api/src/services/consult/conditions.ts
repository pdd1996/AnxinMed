/**
 * conditions 交集注入的档案提取（M4-T8 · specs/04-T8，裁决 #3）——纯函数，零 I/O。
 *
 * 只注入「诊断」字段（用户自述慢病）；allergy 走 T4 确定性覆盖层不进模型通道；
 * gender/birthMonth 不注入（说明书老年用药段本有，注入增益小、个体化倾向强）。
 * 回答模式由 prompt 硬性约束为「说明书事实 × 用户慢病事实的交集陈述，禁止推断」。
 *
 * ⚠️ 出口约束分两层：本函数只做拆分/去重/封顶（条数 + 总字数，防 prompt 膨胀）；
 * PII 脱敏由调用方（consult.service）逐值过 scrubWithPatterns（L3 出口约束）。
 */

/** health_profiles 慢病字段键（PRD §7.1.2 健康信息字段，fieldKey 用中文标签）。 */
export const CONDITIONS_FIELD_KEY = '诊断'

/** 注入封顶（docs/10 §10「注入块字数上限」防 prompt 膨胀）。 */
export const CONDITIONS_MAX_ITEMS = 10
export const CONDITIONS_MAX_CHARS = 200

/**
 * 从 health_profiles 行提取慢病清单：只取「诊断」字段，按中英文分隔符拆分，去重，
 * 条数 ≤10 且总字数 ≤200（超限截断——宁少注入不多注入）。
 */
export function extractConditions(rows: Array<{ fieldKey: string; value: string | null }>): string[] {
  const out: string[] = []
  let chars = 0
  for (const row of rows) {
    if (row.fieldKey !== CONDITIONS_FIELD_KEY) continue
    for (const token of String(row.value ?? '').split(/[,，、;；\s]+/)) {
      const t = token.trim()
      if (!t || out.includes(t)) continue
      if (out.length >= CONDITIONS_MAX_ITEMS || chars + t.length > CONDITIONS_MAX_CHARS) return out
      out.push(t)
      chars += t.length
    }
  }
  return out
}
