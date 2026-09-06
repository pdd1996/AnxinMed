/**
 * 咨询服务编排（M3-T1 · PRD §7.5）——`runConsult`。
 *
 * 分派逻辑（按 guardConsult 决策）：
 *   emergency   → L4 固定文案 + blocked + risk_events 留痕
 *   refused     → L3 固定文案 + blocked + risk_events 留痕
 *   manual-gate → L0 资料查询（说明书段落规则拼装，不调 LLM）+ l0Notice + blocked + risk_events 留痕
 *   no-source   → enableMedicalSearch=true 走 Baichuan 医疗搜索（unverified citation）；否则固定文案
 *   proceed     → 选主咨询药 → pickInsertSections → checkInteractions → ai.consultAnswer
 *                 → AIUnavailable 降级 fallbackSectionsFromInsert → normalizeSections → citations
 *
 * ⚠️ 编排纪律：
 * - 守门决策为纯函数产物（guards.ts），本层只做分派与 I/O 编排；
 * - LLM 输出必过 normalizeSections（stripDosageAdvice + 兜底），绝不直通前端；
 * - AIUnavailableError 不炸整体：转 fallbackSectionsFromInsert（Baichuan 不可用 → 说明书规则拼装）；
 * - 所有返回路径都携带 citations（no-source/emergency/refused 为空数组）与 status/riskLevel，
 *   供路由层统一落 consult_logs。
 */
import { checkInteractions, type InteractionRuleInput } from '../rules/index.js'
import { AIUnavailableError } from '../../lib/ai/types.js'
import { insertCitation, webSearchCitation } from './citations.js'
import { guardConsult } from './guards.js'
import { fallbackSectionsFromInsert, normalizeSections, pickInsertSections } from './sections.js'
import type {
  Citation,
  ConsultDrug,
  ConsultRunInput,
  ConsultRunResult,
  InteractionContext,
  NormalizedSections,
} from './types.js'

/** L4 紧急固定文案（照搬 demo/server/index.js:947-960，已实测）。 */
const EMERGENCY_SECTIONS: NormalizedSections = {
  summary: '你描述的情况可能需要紧急处理。',
  keyPoints: [],
  risks: ['不要等待 AI 继续判断，也不要自行处理。'],
  nextAction: '请立即拨打当地急救电话或尽快前往急诊，并携带药品包装、说明书和已知服药量。',
  warning: '紧急情况下，AI 不能替代急救或专业医疗评估。',
  limited: false,
}

/** L3 拒答固定文案（照搬 demo/server/index.js:962-975，已实测）。 */
const REFUSED_SECTIONS: NormalizedSections = {
  summary: '我不能建议你自行增减剂量、停药或换药。',
  keyPoints: ['用药调整需要结合诊断、检查结果和完整用药情况。'],
  risks: ['自行调整可能导致治疗失败、不良反应或其他风险。'],
  nextAction: '请联系开具处方的医生或药师。',
  warning: '不要根据 AI 回答自行调整处方。',
  limited: false,
}

/** manual-gate 固定提示（PRD §7.5：仅可 L0 资料查询，不可进入个体化解释）。 */
const MANUAL_GATE_NOTICE =
  '该药品为用户手动建档（未经 OCR 确认），AI 个性化咨询不可用，仅可查询药品资料（L0）。'

/** no-source 固定文案（本地未命中且医疗搜索默认关；照搬 demo:982-995）。 */
function buildNoSourceResult(drugName: string, enableMedicalSearch: boolean): ConsultRunResult {
  const summary = `本地说明书库未收录「${drugName}」，${
    enableMedicalSearch ? '医疗搜索兜底不可用' : '医疗搜索默认关闭'
  }，我无法提供可追溯的资料解释。请查看药品说明书或咨询医生、药师。`
  return {
    riskLevel: 'L1',
    status: 'no-source',
    answer: summary,
    sections: {
      summary,
      keyPoints: ['本地说明书库按 drugId 直查，该药品未命中'],
      risks: [],
      nextAction: '请查看药品说明书或咨询医生、药师。',
      warning: '不要根据未标注来源的网络资料自行调整用药。',
      limited: false,
    },
    citations: [],
    notice: enableMedicalSearch
      ? '医疗搜索兜底调用失败，请稍后重试或查看药品说明书。'
      : '正式版在本地说明书库未命中时会开启医疗搜索兜底，且回答标注「基于网络检索，未经本库核实」。',
    l0Notice: null,
    blocked: false,
    matchedKeyword: null,
    triggerDrugId: null,
  }
}

/** 相互作用上下文组装（复用 M2-T5 checkInteractions，按主咨询药 + 生效计划集合匹配）。 */
function buildInteractionContext(
  primaryMasterId: string | null,
  activeMasterIds: string[],
  rules: InteractionRuleInput[],
  nameById: Record<string, string>,
): InteractionContext {
  // 主咨询药并入生效集合（去重）——咨询对象可能不在当前生效计划里（如已停药但仍在药箱）
  const ids = [...new Set([...activeMasterIds, ...(primaryMasterId ? [primaryMasterId] : [])])]
  const result = checkInteractions(ids, rules, nameById)
  return {
    has: result.hits.length > 0,
    items: result.hits.map((h) => ({
      level: h.level,
      note: h.note,
      source: h.source,
      drugNames: h.drugNames,
    })),
    coverageNote: result.coverageNote,
  }
}

/** 选主咨询药（多药场景取第一个；citations 只含主药三件套，前端可多次调用实现多药咨询）。 */
function pickPrimaryDrug(drugs: ConsultDrug[]): ConsultDrug | null {
  return drugs.find((d) => d.insert !== null) ?? drugs[0] ?? null
}

/**
 * 咨询编排主入口（纯 I/O 编排；守门决策为纯函数产物）。
 * @returns ConsultRunResult 统一形态，路由层据此落 consult_logs + risk_events 并返回前端。
 */
export async function runConsult(input: ConsultRunInput): Promise<ConsultRunResult> {
  const { question, drugs, activeMasterIds, interactionRules, drugNameById, enableMedicalSearch, ai } = input

  // ── 1. 守门决策（纯函数，先命中先返回）──
  const decision = guardConsult(question, drugs)

  // ── 2. L4 紧急信号 ──
  if (decision.kind === 'emergency') {
    return {
      riskLevel: 'L4',
      status: 'emergency',
      answer: EMERGENCY_SECTIONS.summary + EMERGENCY_SECTIONS.nextAction,
      sections: EMERGENCY_SECTIONS,
      citations: [],
      notice: null,
      l0Notice: null,
      blocked: true,
      matchedKeyword: decision.matched,
      triggerDrugId: drugs[0]?.id ?? null,
    }
  }

  // ── 3. L3 拒答 ──
  if (decision.kind === 'refused') {
    return {
      riskLevel: 'L3',
      status: 'refused',
      answer: REFUSED_SECTIONS.summary + REFUSED_SECTIONS.nextAction,
      sections: REFUSED_SECTIONS,
      citations: [],
      notice: null,
      l0Notice: null,
      blocked: true,
      matchedKeyword: decision.matched,
      triggerDrugId: drugs[0]?.id ?? null,
    }
  }

  // ── 4. manual-gate：仅 L0 资料查询（不调 LLM，用说明书段落规则拼装）──
  if (decision.kind === 'manual-gate') {
    const primary = pickPrimaryDrug(drugs)
    // manual 档也可能命中说明书（demo findInsertByDrug 的 nameMatches 兜底路径）
    if (primary?.insert) {
      const sections = fallbackSectionsFromInsert(question, primary.insert)
      return {
        riskLevel: 'L1',
        status: 'manual-gate',
        answer: sections.summary,
        sections,
        citations: [insertCitation(primary.insert)],
        notice: null,
        l0Notice: MANUAL_GATE_NOTICE,
        blocked: true, // 个体化解释被拒绝（但 L0 资料查询仍返回）
        matchedKeyword: null,
        triggerDrugId: primary.id,
      }
    }
    // manual 档 + 说明书也未命中 → 仍返回 manual-gate（门禁基于 confirmStatus，不基于 insert）
    // 附固定文案说明"未经 OCR 确认且本地未收录"，避免前端拿到空 sections
    const drugName = primary?.genericName ?? '该药品'
    const summary = `「${drugName}」为手动建档（未经 OCR 确认）且本地说明书库未收录，无法提供资料查询。请查看药品说明书或咨询医生、药师。`
    return {
      riskLevel: 'L1',
      status: 'manual-gate',
      answer: summary,
      sections: {
        summary,
        keyPoints: ['手动建档药品仅可做 L0 资料查询', '本地说明书库按药名兜底也未命中'],
        risks: [],
        nextAction: '请查看药品说明书或咨询医生、药师。',
        warning: '不要根据未标注来源的资料自行调整用药。',
        limited: false,
      },
      citations: [],
      notice: null,
      l0Notice: MANUAL_GATE_NOTICE,
      blocked: true,
      matchedKeyword: null,
      triggerDrugId: primary?.id ?? null,
    }
  }

  // ── 5. no-source：本地未命中 ──
  if (decision.kind === 'no-source') {
    const primary = pickPrimaryDrug(drugs)
    const drugName = primary?.genericName ?? '该药品'

    // 5a. 医疗搜索兜底（PRD §7.5：env 开关 ENABLE_MEDICAL_SEARCH，默认 false）
    if (enableMedicalSearch && ai.medicalSearch) {
      try {
        const raw = await ai.medicalSearch(question, drugName)
        const sections = normalizeSections(raw, {
          summaryFallback: `关于「${drugName}」的网络检索资料请以说明书为准。`,
        })
        return {
          riskLevel: sections.limited ? 'L2' : 'L1',
          status: sections.limited ? 'limited' : 'answered',
          answer: sections.summary,
          sections,
          citations: [webSearchCitation(drugName)],
          notice: sections.limited
            ? '已过滤具体剂量建议。用量请按医生处方或说明书执行。'
            : '基于网络检索，未经本库核实。',
          l0Notice: null,
          blocked: false,
          matchedKeyword: null,
          triggerDrugId: null,
        }
      } catch (e) {
        // 医疗搜索失败 → 降级为 no-source 固定文案（不炸整体）
        if (e instanceof AIUnavailableError) {
          return buildNoSourceResult(drugName, true)
        }
        throw e
      }
    }

    // 5b. 医疗搜索默认关 → 固定文案
    return buildNoSourceResult(drugName, enableMedicalSearch)
  }

  // ── 6. proceed：进入生成路径 ──
  const primary = pickPrimaryDrug(drugs)
  if (!primary?.insert) {
    // 理论不可达（guardConsult 已过滤 no-source）；防御性兜底
    return buildNoSourceResult(primary?.genericName ?? '该药品', enableMedicalSearch)
  }

  const insert = primary.insert
  const section = pickInsertSections(question, insert)
  const interactions = buildInteractionContext(
    primary.drugMasterId,
    activeMasterIds,
    interactionRules,
    drugNameById,
  )
  const isManual = primary.confirmStatus === 'manual'
  const l0Notice = isManual ? MANUAL_GATE_NOTICE : null

  // 6a. 调 Baichuan（AIUnavailableError → 降级 fallbackSectionsFromInsert）
  let sections: NormalizedSections
  let aiNotice: string | null = null
  try {
    const raw = await ai.consultAnswer({
      question,
      drug: {
        genericName: insert.genericName,
        brandName: insert.brandName,
        specification: insert.specification,
        form: insert.form,
        isManual,
      },
      section: { label: section.label, version: insert.version, text: section.text },
      interactionsText: renderInteractionsForPrompt(interactions),
    })
    sections = normalizeSections(raw, {
      summaryFallback: section.text.replace(/^[^：:]+[：:]/, '').slice(0, 120),
      keyPointsFallback: Array.isArray(insert.precautions)
        ? (insert.precautions as unknown[]).slice(0, 2).map(String)
        : [],
      risksFallback: Array.isArray(insert.contraindications)
        ? (insert.contraindications as unknown[]).slice(0, 2).map(String)
        : [],
    })
  } catch (e) {
    if (e instanceof AIUnavailableError) {
      // Baichuan 不可用 → 降级为说明书规则拼装（不炸整体，附 notice 说明）
      sections = fallbackSectionsFromInsert(question, insert)
      aiNotice = '百川服务不可用，回答由本地说明书库规则拼装（演示降级）。'
    } else {
      throw e
    }
  }

  // 6b. 组装 citations（三件套：药名 + source + version）
  const citations: Citation[] = [insertCitation(insert)]

  // 6c. L2 剂量过滤命中 → riskLevel 升 L2 + status='limited' + 固定提示语
  const notice = sections.limited
    ? '已过滤具体剂量建议。用量请按医生处方或说明书执行。'
    : aiNotice

  return {
    riskLevel: sections.limited ? 'L2' : 'L1',
    status: sections.limited ? 'limited' : 'answered',
    answer: sections.summary,
    sections,
    citations,
    notice,
    l0Notice,
    blocked: false,
    matchedKeyword: null,
    triggerDrugId: null,
  }
}

/** 相互作用上下文渲染为 prompt 文本（与 prompt.ts renderInteractions 同款；拆出避免循环依赖）。 */
function renderInteractionsForPrompt(ctx: InteractionContext): string {
  if (ctx.has && ctx.items.length > 0) {
    const lines = ctx.items.map(
      (i) => `- [${i.level}] ${i.note}（来源：${i.source}；涉及：${i.drugNames.join('、')}）`,
    )
    return `生效计划集合中的相互作用提示（规则库抄录，需在回答中提示用户关注）：\n${lines.join('\n')}`
  }
  if (ctx.coverageNote) {
    return `生效计划集合中未见已知相互作用。${ctx.coverageNote}`
  }
  return '生效计划集合中未见已知相互作用（规则库覆盖有限，未覆盖不表示无风险）。'
}

/** 供路由层注入的 AI 客户端类型再导出（避免路由层直接 import lib/ai）。 */
export type { AiClients } from '../../lib/ai/types.js'
