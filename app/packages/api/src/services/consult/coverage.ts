/**
 * 引用注入完整性校验（M4-T9 · specs/04-T9）——纯函数，零 I/O。
 *
 * 断言：每条带段落锚点（sectionKey）的 citation，其 (drugName, sectionKey) 必须 ∈ 本轮
 * 证据集合（管线产物：run.ts 登记 prompt 注入的段落；consult.service 登记确定性覆盖层
 * 使用的段落——如过敏匹配的禁忌段）。防止引用指向本轮从未使用的资料（引用漂移）。
 *
 * ⚠️ 明确声明（specs/04-T9）：citation-washing（回答内容不忠实于所引段落）为**接受的残余
 * 风险**——不做 NLP 断言检测（要么恒真要么误杀）；缓解 = prompt「只基于给定段落回答」
 * 硬性规则 + docs/11 不变量 golden 抽样复审。本函数只保证「锚点 ∈ 证据集合」这一层。
 */
import type { Citation } from './types.js'

/** 一轮回答的证据集合（管线产物；随管线产出逐项登记）。 */
export interface CitationEvidence {
  /** 登记的段落：prompt 注入的说明书段落 + 确定性覆盖层使用的段落（如禁忌段）。 */
  sections: Array<{ drugName: string; sectionKey: string }>
}

export type CoverageVerdict = { ok: true } | { ok: false; violation: string }

/** 单条 citation 的锚点是否在证据集合内。 */
function anchoredIn(c: Citation, evidence: CitationEvidence): boolean {
  if (!c.sectionKey) return true // 无锚点 = 三件套级整体引用（insert 本体在证据内），不违反
  return evidence.sections.some((s) => s.drugName === c.drugName && s.sectionKey === c.sectionKey)
}

/**
 * 引用注入完整性校验：全部通过 → { ok: true }；存在越界锚点 → { ok: false, violation }（首个违规）。
 * 调用方（consult.service）对违规的处置 = 剥离越界锚点引用（保留三件套基础引用，回答不受影响），
 * 并 console.error 留痕（失败可见不静默）。
 */
export function validateCitationCoverage(citations: Citation[], evidence: CitationEvidence): CoverageVerdict {
  for (const c of citations) {
    if (!anchoredIn(c, evidence)) {
      return {
        ok: false,
        violation: `citation 锚点越界：drugName=${c.drugName} sectionKey=${c.sectionKey} 不在本轮证据集合（共 ${evidence.sections.length} 个登记段落）`,
      }
    }
  }
  return { ok: true }
}
