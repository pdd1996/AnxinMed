/**
 * L0（资料查询）固定提示文案（2026-11-20 简化）——manual 门禁与未核验门禁共用。
 *
 * 用户文案不出现内部术语（L0 / AI 个性化咨询）；只说明：为什么只能看原文 + 以什么为准。
 * 保持「手动建档」「未经 OCR 确认」「尚未人工核验」这些可核验关键词（测试与 UI 提示一致）。
 */

/** manual 档门禁固定提示（PRD §7.5：仅可资料查询，不可进入个体化解释）。 */
export const MANUAL_GATE_NOTICE =
  '该药为手动建档（未经 OCR 确认），暂不能提供个性化解释，仅可查看说明书原文。'

/** 说明书未核验提示（资产侧门禁：curationStatus !== reviewed）。 */
export const UNVERIFIED_NOTICE =
  '该药说明书尚未人工核验，暂不能提供个性化解释，仅可查看说明书原文。'

/** 在固定提示后补「涉及：药名」——多药/无上下文时用户能对上对象。 */
export function withDrugNames(notice: string, drugNames: Array<string | null | undefined>): string {
  const names = [...new Set(drugNames.map((n) => (n ?? '').trim()).filter(Boolean))]
  return names.length > 0 ? `${notice}涉及：${names.join('、')}。` : notice
}
