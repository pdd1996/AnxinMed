/**
 * 外部知识兜底（决赛演示版 · 百川医疗大模型）—— local 库未收录的「物质×药物」同服问题。
 *
 * 背景：酒/西柚/咖啡等非药品实体进不了说明书库；现行 no-source 诚实拒答。
 * 本模块提供一条**独立、可选、可回滚**的兜底层：
 *   - 只在 S1 且无绑定药、无对象澄清时触发；
 *   - 仅匹配「同服/一起吃/能不能」类问题，且必须出现酒/西柚/咖啡等非药品物质；
 *   - 优先调百川医疗大模型（未配置则千问文本）生成；
 *   - 模型输出必须过安全清洗（禁剂量/禁绝对安全/禁停换药/禁诊断），不过关 → 固定通用提示；
 *   - 一律标 `unverified:true` + 「AI 生成，仅供参考」notice，不作为本地说明书证据。
 *
 * 注意：这是演示/试点能力，PRD §7.5 / ADR #20 的正式修订待裁决（specs/23）。
 * env `ENABLE_EXTERNAL_KNOWLEDGE=false` 可整体关闭回到现有 no-source。
 */
import type { AiClients, ConsultRawSections, ConsultRunResult, NormalizedSections } from './types.js'

/** 模型回答固定免责声明（notice + sections.warning 双保险，旧客户端也可见）。 */
export const EXTERNAL_AI_DISCLAIMER = '以下内容由 AI 生成，仅供参考；不是本地说明书证据，不能替代医生或药师的判断。'

/** 无模型可用时的通用安全提示声明（不冒充 AI 生成）。 */
export const EXTERNAL_FALLBACK_NOTICE = 'AI 服务暂不可用，以下为通用用药安全提示，仅供参考；请咨询医生或药师。'

/** 非药品物质关键词（首批：酒精、含醇制剂、西柚、咖啡/浓茶）。 */
export const SUBSTANCE_PATTERN =
  /酒|酒精|白酒|啤酒|红酒|黄酒|米酒|藿香正气水|西柚|柚子|葡萄柚|咖啡|浓茶|茶/

/** 同服/相互影响类问法。 */
export const COUSE_PATTERN =
  /一起|同时|同服|同吃|同喝|能不能|可不可以|可否|能喝|能同服|冲突|相互作用|相克|忌口|隔多久|有影响|有风险/

/** 药品/制剂语境词（避免把“喝酒去哪里”之类生活问题拉进来）。 */
const MEDICATION_HINT_PATTERN = /药|片|胶囊|颗粒|口服液|滴丸|软胶囊|冲剂|头孢|甲硝唑|藿香|他汀|地平|洛尔|普利|沙坦|列汀|列净|双胍|阿司匹林|华法林|硝酸甘油/

/** 剂量/频次类问题不走外部知识（属于高风险个体化建议，交 S0/说明书管线）。 */
const DOSAGE_QUESTION_PATTERN = /剂量|吃几片|吃多少|喝多少|服用多少|每天几次|一日几次|疗程/

/** env 开关：外部知识兜底（默认开，仅显式 false 关闭；演示期可回滚）。 */
export function isExternalKnowledgeEnabled(): boolean {
  return String(process.env.ENABLE_EXTERNAL_KNOWLEDGE ?? '').toLowerCase() !== 'false'
}

/**
 * 是否走外部知识兜底（纯规则，保守）：
 * 非药品物质 + 同服/相互影响问法 + 药品语境，且不是剂量类问题。
 * 范围层（诊断/非用药）、S0、S2、对象澄清均在此之前/之后有各自优先级，本函数只负责最后一层。
 */
export function shouldAnswerExternalKnowledge(question: string): boolean {
  const q = String(question ?? '').trim()
  if (q.length === 0 || q.length > 120) return false
  if (DOSAGE_QUESTION_PATTERN.test(q)) return false
  if (!SUBSTANCE_PATTERN.test(q)) return false
  if (!COUSE_PATTERN.test(q)) return false
  return MEDICATION_HINT_PATTERN.test(q)
}

/** 模型输出安全红线：剂量/绝对安全/停换药/诊断，命中即整段弃用。 */
const MODEL_DOSAGE_PATTERN = /每次|每日|一天|疗程|剂量|多少片|毫克|\d+\s*mg|\d+\s*ml|毫升/i
const MODEL_AFFIRM_PATTERN = /可以一起|可以同服|可以同时|放心吃|放心喝|可以喝酒|没问题|绝对安全|不会有风险|没有影响/
const MODEL_PROHIBITED_PATTERN = /建议停药|建议换药|开处方|诊断为|你得了|确诊/

/** 原始模型分区 → 安全分区（不过红线才返回；否则 null，由上层回退固定提示）。 */
export function sanitizeExternalSections(raw: ConsultRawSections | null): NormalizedSections | null {
  if (!raw) return null
  const summary = String(raw.summary ?? '').trim()
  if (summary.length < 6 || summary.length > 160) return null
  const keys = (raw.keyPoints ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
  const risks = (raw.risks ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
  const nextAction = String(raw.nextAction ?? '').trim()
  const warning = String(raw.warning ?? '').trim()
  const all = [summary, ...keys, ...risks, nextAction, warning].join('')
  if (MODEL_DOSAGE_PATTERN.test(all)) return null
  if (MODEL_AFFIRM_PATTERN.test(all)) return null
  if (MODEL_PROHIBITED_PATTERN.test(all)) return null
  return {
    summary,
    keyPoints: keys,
    risks,
    nextAction: nextAction || '具体请咨询医生或药师；如有不适，请及时就医。',
    warning: `${warning || '不要自行调整用药，具体请咨询医生或药师。'}（AI 生成，仅供参考）`,
    limited: false,
  }
}

/** 固定通用安全提示（无模型/模型输出不合格时使用；内容为人工配置，不冒充 AI）。 */
export function buildFallbackSections(question: string): NormalizedSections {
  const q = String(question ?? '')
  const mentionsAlcohol = /酒|酒精|白酒|啤酒|红酒|黄酒|米酒/.test(q)
  const mentionsHuoxiang = /藿香/.test(q)
  if (mentionsAlcohol) {
    return {
      summary: mentionsHuoxiang
        ? '不建议把酒和藿香正气水一起服用：这类制剂通常含乙醇，同服会增加酒精摄入。'
        : '不建议在用药期间饮酒。',
      keyPoints: [
        mentionsHuoxiang
          ? '藿香正气水通常含乙醇（酒精），与酒同服会叠加酒精摄入。'
          : '酒精可能与部分药物相互影响，增加不适或不良反应风险。',
        '如果同时在服用头孢类、甲硝唑等药物，饮酒可能诱发双硫仑样反应（面部潮红、心悸、恶心等），需特别警惕。',
        '以上为通用安全提示，不针对具体病情或具体药品说明书。',
      ],
      risks: ['同服可能增加胃肠道刺激、头晕、心悸等风险；出现严重不适请立即就医。'],
      nextAction: '用药期间避免饮酒；如已同服或出现不适，请立即咨询医生、药师或就医。',
      warning: '这是通用安全提示，不是用药建议；具体请以药品说明书和医生医嘱为准。',
      limited: false,
    }
  }
  return {
    summary: '这类食物/饮品与药物同服可能存在相互影响，不建议自行同服。',
    keyPoints: [
      '某些食物或饮品可能影响药物的吸收、代谢或增加不良反应风险。',
      '具体是否冲突取决于药品成分和你的身体情况，无法仅凭一句话判断。',
      '以上为通用安全提示，不针对具体药品说明书。',
    ],
    risks: ['同服可能增加不适或不良反应风险；出现严重不适请立即就医。'],
    nextAction: '请咨询医生或药师；如已同服且出现不适，请及时就医。',
    warning: '这是通用安全提示，不是用药建议；具体请以药品说明书和医生医嘱为准。',
    limited: false,
  }
}

/** 外部知识回答的引用（IV 级证据：模型知识，未经本库核实；fallback 为人工配置提示，不冒充 AI）。 */
export function buildExternalCitation(
  modelLabel: string,
  fallback = false,
): ConsultRunResult['citations'][number] {
  const date = new Date().toISOString().slice(0, 10)
  const citation: ConsultRunResult['citations'][number] = fallback
    ? {
        drugName: '通用安全提示（人工配置）',
        source: '人工配置的用药安全提示（非本地说明书，未经人工核验）',
        version: `fallback · ${date}`,
        unverified: true,
      }
    : {
        drugName: 'AI 生成（通用医学知识）',
        source: '外部医疗大模型（非本地说明书，未经人工核验）',
        version: `${modelLabel} · ${date}`,
        unverified: true,
      }
  return citation
}

export interface ExternalAnswer {
  result: ConsultRunResult
  /** ai = 模型生成；fallback = 固定提示（模型不可用/输出不合格）。 */
  source: 'ai' | 'fallback'
}

/** 组装外部知识回答结果（status 复用 answered，旧客户端可正常渲染）。 */
export function buildExternalResult(
  sections: NormalizedSections,
  opts: { notice: string; modelLabel: string; fallback?: boolean },
): ConsultRunResult {
  return {
    riskLevel: 'L1',
    status: 'answered',
    answer: sections.summary,
    sections,
    citations: [buildExternalCitation(opts.modelLabel, opts.fallback === true)],
    notice: opts.notice,
    l0Notice: null,
    blocked: false,
    matchedKeyword: null,
    triggerDrugId: null,
  }
}

/**
 * 调模型 → 安全清洗 → 失败回退固定提示。绝不静默失败：fallback 也有明确 notice + 引用。
 * 本函数不判断是否该走外部知识（由 shouldAnswerExternalKnowledge 决定）。
 */
export async function answerExternalKnowledge(
  ai: AiClients,
  question: string,
): Promise<ExternalAnswer> {
  if (ai.externalKnowledge) {
    try {
      const output = await ai.externalKnowledge(question)
      const sections = sanitizeExternalSections(output.sections)
      if (!sections) console.error('[consult/external] 模型输出未通过安全清洗，回退固定提示')
      if (sections) {
        return {
          result: buildExternalResult(sections, {
            notice: EXTERNAL_AI_DISCLAIMER,
            modelLabel: output.modelLabel,
          }),
          source: 'ai',
        }
      }
    } catch (e) {
      // 失败可见：错误只写 stderr（不含问题原文/模型输出），再由下方固定提示兜底
      console.error(
        '[consult/external] 模型调用失败：',
        e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      )
    }
  }
  return {
    result: buildExternalResult(buildFallbackSections(question), {
      notice: EXTERNAL_FALLBACK_NOTICE,
      modelLabel: '通用安全提示（人工配置）',
      fallback: true,
    }),
    source: 'fallback',
  }
}
