/**
 * 「说明书可用性」确定性意图（2026-11-20）——0 次 LLM、0 写入。
 *
 * 触发：绑定药品 + 问题在问「有没有/能不能看说明书」（而不是问内容）。
 * 输出（复用既有 status，不扩枚举）：
 * - 已收录且已核验：status='answered'，给来源/版本/批准文号/核验状态 + 查看入口；
 * - 已收录但未核验：status='answered' + l0Notice（前端按 L0 版式渲染 banner），只给原文入口；
 * - 未收录：status='no-source'，诚实说明并指向补录路径。
 *
 * 与「问内容」的边界：问题须同时含「说明书」与可用性问法；只有「说明书」或内容词
 * （禁忌/副作用/怎么吃…）不触发，继续走 S1 说明书管线。
 */

import { insertCitation } from './citations.js'
import { buildLeafletView } from './leaflet.js'
import { UNVERIFIED_NOTICE } from './notices.js'
import { digestShortText, leafletNextAction } from './sections.js'
import type { ConsultDrug, ConsultRunResult, InsertSlice } from './types.js'

const LEAFLET_WORD_RE = /说明书|药品说明|用药说明/
const AVAILABILITY_ASK_RE =
  /有吗|有没|有没有|有无|能看|可以看|看看|看下|看一下|查看|哪看|在哪|提供|发我|收录|查到|找到|帮我查|查查|查一下/

/** 是否在问「说明书有没有/能不能看」（纯函数；不含内容问句）。 */
export function isInsertAvailabilityQuestion(question: string): boolean {
  const q = String(question ?? '')
  return LEAFLET_WORD_RE.test(q) && AVAILABILITY_ASK_RE.test(q)
}

/** 药名 + 规格（身份展示统一用）。 */
function drugLabel(insert: InsertSlice): string {
  const brand = insert.brandName ? `（${insert.brandName}）` : ''
  const spec = insert.specification ? ` ${insert.specification}` : ''
  return `${insert.genericName}${brand}${spec}`
}

/** 来源三件套的展示文案（缺字段时如实标注，不猜）。 */
function sourceLine(insert: InsertSlice): string {
  const source = insert.source || '未标注来源'
  const version = insert.version || '未标注版本'
  const approvals =
    insert.approvalNumbers && insert.approvalNumbers.length > 0
      ? insert.approvalNumbers.join('、')
      : '批准文号未标注'
  return `来源：${source}；版本：${version}；批准文号：${approvals}`
}

/**
 * 组装「说明书可用性」确定性回答。
 * @param drugs 已按 userId + drugIds 解析的咨询对象（至少 1 个）
 */
export function buildInsertAvailabilityResult(drugs: ConsultDrug[]): ConsultRunResult {
  const primary = drugs.find((d) => d.insert !== null) ?? drugs[0] ?? null
  const insert = primary?.insert ?? null

  if (!primary) {
    return {
      riskLevel: 'L1',
      status: 'no-source',
      answer: '该问题未关联药箱药品，无法查询说明书。',
      sections: {
        summary: '该问题未关联药箱药品，无法查询说明书。',
        keyPoints: [],
        risks: [],
        nextAction: '请先在药箱选择一种药，再问说明书。',
        warning: '不要根据未标注来源的资料自行调整用药。',
        limited: false,
      },
      citations: [],
      notice: null,
      l0Notice: null,
      blocked: false,
      matchedKeyword: null,
      triggerDrugId: null,
      leafletDrugId: null,
    }
  }

  if (!insert) {
    const summary = `本地说明书库暂未收录「${primary.genericName}」的说明书。`
    return {
      riskLevel: 'L1',
      status: 'no-source',
      answer: summary,
      sections: {
        summary,
        keyPoints: [],
        risks: [],
        nextAction: '可在「药箱」为该药拍照补录说明书，或咨询医生、药师。',
        warning: '不要根据未标注来源的网络资料自行调整用药。',
        limited: false,
      },
      citations: [],
      notice: null,
      l0Notice: null,
      blocked: false,
      matchedKeyword: null,
      triggerDrugId: null,
      leafletDrugId: null,
    }
  }

  const reviewed = insert.curationStatus === 'reviewed'
  const label = drugLabel(insert)
  // 来源三件套不塞进 summary（未核验卡顶部 banner 已展示；reviewed 卡放首条要点），避免首屏重复。
  const summary = reviewed
    ? `已收录「${label}」的说明书（已人工核验）。`
    : `已收录「${label}」的说明书原文，但尚未人工核验。`

  const leafletView = buildLeafletView(insert)
  const contraindication = leafletView.sections.find((s) => s.key === 'contraindication')
  const risks = contraindication ? [digestShortText(contraindication.body, 50)] : []
  const viewHint = reviewed
    ? '可点「查看完整说明书」按分段查看原文；具体是否适用请咨询医生或药师。'
    : '可点「查看完整说明书」查看分段原文；请以药品包装内说明书为准。'

  return {
    riskLevel: 'L1',
    status: 'answered',
    answer: summary,
    sections: {
      summary,
      keyPoints: reviewed
        ? [`${sourceLine(insert)}。`, '可按「查看完整说明书」分段查看适应症、禁忌、注意事项、特殊人群、相互作用等。']
        : [
            '以下内容为说明书原文摘录，仅供查阅，请以药品包装内说明书为准。',
            '如需个体化用药建议，请咨询医生或药师。',
          ],
      risks,
      nextAction: leafletNextAction([summary, ...risks, viewHint]),
      warning: '不要根据 AI 回答自行调整处方。',
      limited: false,
    },
    citations: [insertCitation(insert)],
    notice: null,
    // banner 已展示药名/规格/来源/批准文号，这里不再重复「涉及：药名」。
    l0Notice: reviewed ? null : UNVERIFIED_NOTICE,
    blocked: false,
    matchedKeyword: null,
    triggerDrugId: null,
    leafletDrugId: primary.id,
  }
}
