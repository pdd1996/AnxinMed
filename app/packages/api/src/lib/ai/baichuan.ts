/**
 * Baichuan-M3-Plus 客户端（M2-T1 兜底解析 + M3-T1 咨询回答/医疗搜索）。
 * 发给模型的内容只含 L0 裁剪后的白名单文本（不含图像/PII 之外内容），由请求体组装单测保证。
 */
import {
  AIUnavailableError,
  type ConsultPromptPayload,
  type ConsultRawSections,
  type FallbackFields,
  type InsightPromptPayload,
} from './types.js'
import { callJson, extractChatContent, parseModelJson, type ChatResponse } from './http.js'
import { ConsultRawSectionsSchema, FallbackParseSchema } from './schemas.js'

/** 兜底解析请求体（纯函数，可测）。只含白名单文本 + 缺项字段名，不含图像。 */
export function buildFallbackParseRequest(bodyText: string, missingFields: string[]) {
  const prompt =
    '你是处方正文解析器。仅从下面提供的处方正文文本中提取指定字段，逐字抄录、不得推测或补全；' +
    `需要提取的字段：${missingFields.join('、')}。只输出一个 JSON 对象（字段键→字符串值）。` +
    `处方正文如下：\n${bodyText}`
  return {
    model: process.env.BAICHUAN_MODEL ?? 'baichuan-m3-plus',
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  }
}

export async function fallbackParse(bodyText: string, missingFields: string[]): Promise<FallbackFields> {
  const baseUrl = process.env.BAICHUAN_BASE_URL
  const key = process.env.BAICHUAN_API_KEY
  if (!baseUrl || !key) {
    throw new AIUnavailableError('baichuan', '缺少 BAICHUAN_BASE_URL / BAICHUAN_API_KEY 配置')
  }
  const res = await callJson<ChatResponse>(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(buildFallbackParseRequest(bodyText, missingFields)),
    },
    { client: 'baichuan' },
  )
  const raw = parseModelJson(extractChatContent(res, 'baichuan'), 'baichuan')
  const parsed = FallbackParseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AIUnavailableError('baichuan', `兜底解析输出不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// M3-T1：咨询回答（本地说明书 + 相互作用上下文 → 结构化回答）
// ---------------------------------------------------------------------------

/**
 * 咨询回答请求体组装（纯函数，可测）：只含白名单文本（药品身份快照 + 说明书段落 + 相互作用渲染文本 + 用户问题）。
 * 与 demo/server/index.js:1019-1050 等价，拆出为独立函数便于单测与 E2E fixture 回放。
 */
export function buildConsultRequest(payload: ConsultPromptPayload) {
  const { question, drug, section, interactionsText } = payload
  const content = `你是"安心用药"药品资料解释助手，基于已确认药品的本地说明书库回答问题。

硬性规则：
1. 只输出严格 JSON，禁止 Markdown、禁止 **粗体**、禁止 ^[1]^ 这类引用编号。
2. 总字数控制在 150-250 个汉字。
3. 不得给出具体剂量、频次、疗程数字，不得说"一日X片/每次X mg"。
4. 不得诊断、开处方、建议停换药；不预测个体疗效（"对你效果如何"不回答）。
5. 解释药理作用时使用通俗语言，说明"是什么、为什么这样用"。
6. 只基于下方提供的说明书段落与相互作用资料回答，资料未覆盖的内容明确说明，不要编造。
7. 不要结尾追问。

JSON 格式：
{"summary":"一句话直接回答","keyPoints":["最多3条"],"risks":["最多3条"],"nextAction":"下一步建议","warning":"不要自行调整处方的提示"}

已确认药品：${drug.genericName}${drug.brandName ? `（${drug.brandName}）` : ''}；规格：${drug.specification || '未标注'}；剂型：${drug.form || '未标注'}。
${drug.isManual ? '注意：该药品为用户手动建档（未经 OCR 确认），回答仅做一般性资料解释（L0），不得结合个体情况展开。' : ''}
本次取用的说明书段落（${section.label}，版本 ${section.version || '未标注'}）：
${section.text}

${interactionsText}

用户问题：${question}`

  return {
    model: process.env.BAICHUAN_MODEL ?? 'baichuan-m3-plus',
    temperature: 0.1,
    messages: [{ role: 'user' as const, content }],
  }
}

/** 咨询回答：本地说明书 + 相互作用上下文 → 结构化分区。输出过 ConsultRawSectionsSchema safeParse。 */
export async function consultAnswer(payload: ConsultPromptPayload): Promise<ConsultRawSections> {
  const baseUrl = process.env.BAICHUAN_BASE_URL
  const key = process.env.BAICHUAN_API_KEY
  if (!baseUrl || !key) {
    throw new AIUnavailableError('baichuan', '缺少 BAICHUAN_BASE_URL / BAICHUAN_API_KEY 配置')
  }
  const res = await callJson<ChatResponse>(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(buildConsultRequest(payload)),
    },
    { client: 'baichuan' },
  )
  const raw = parseModelJson(extractChatContent(res, 'baichuan'), 'baichuan')
  const parsed = ConsultRawSectionsSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AIUnavailableError('baichuan', `咨询回答输出不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}

/**
 * 医疗搜索兜底请求体（纯函数，可测）：PRD §7.5，本地未命中且 ENABLE_MEDICAL_SEARCH=true 才触发。
 * 明确标注"基于网络检索，未经本库核实"，且只做一般性资料解释。
 */
export function buildMedicalSearchRequest(question: string, drugName: string) {
  const content = `你是"安心用药"医疗资料检索助手。本地说明书库未收录「${drugName}」，请基于网络检索结果回答用户问题。

硬性规则：
1. 只输出严格 JSON（格式同下），禁止 Markdown。
2. 总字数 150-250 汉字。
3. 不得给出具体剂量/频次/疗程数字。
4. 不得诊断、开处方、建议停换药；不预测个体疗效。
5. 明确标注"基于网络检索，未经本库核实"；只做一般性资料解释，不结合个体情况。
6. 检索不到的内容明确说明"未检索到可靠资料"，不编造。

JSON 格式：
{"summary":"一句话直接回答","keyPoints":["最多3条"],"risks":["最多3条"],"nextAction":"下一步建议","warning":"不要自行调整处方的提示"}

用户问题：${question}
药品名：${drugName}`

  return {
    model: process.env.BAICHUAN_MODEL ?? 'baichuan-m3-plus',
    temperature: 0.1,
    messages: [{ role: 'user' as const, content }],
  }
}

/** 医疗搜索兜底：未配置 BAICHUAN_API_KEY 或未实现时抛 AIUnavailableError，上层转 no-source 降级。 */
export async function medicalSearch(question: string, drugName: string): Promise<ConsultRawSections> {
  const baseUrl = process.env.BAICHUAN_BASE_URL
  const key = process.env.BAICHUAN_API_KEY
  if (!baseUrl || !key) {
    throw new AIUnavailableError('baichuan', '医疗搜索兜底不可用：缺少 BAICHUAN_BASE_URL / BAICHUAN_API_KEY 配置')
  }
  const res = await callJson<ChatResponse>(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(buildMedicalSearchRequest(question, drugName)),
    },
    { client: 'baichuan' },
  )
  const raw = parseModelJson(extractChatContent(res, 'baichuan'), 'baichuan')
  const parsed = ConsultRawSectionsSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AIUnavailableError('baichuan', `医疗搜索输出不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// M3-T3：医生端摘要（5 个只读工具输出 + 患者信息 → 结构化摘要）
// ---------------------------------------------------------------------------

/**
 * 医生端摘要请求体组装（纯函数，可测）：照搬 demo/server/index.js:1355-1378 的实测 prompt。
 * 只含 5 个只读工具的聚合输出 + 患者基本信息，不含 PII 原文。
 */
export function buildInsightRequest(payload: InsightPromptPayload) {
  const { patient, dateRange, tools } = payload
  const { adherence, medicationCount, medicationNames, interactions, expiry, riskEvents } = tools

  const interactionsText = interactions.length > 0 ? interactions.join('；') : '未见明确相互作用'
  const skipDetailsText = adherence.consecutiveSkip > 0 ? `，漏服明细 ${adherence.skipDetails.join('、')}` : ''

  const content = `你是"安心用药"演示版的患者洞察助手，为医生生成诊前用药摘要。只基于以下工具输出的事实生成摘要，不要编造数据。

硬性规则：
1. 只输出严格 JSON，禁止 Markdown、禁止 **粗体**、禁止引用编号。
2. 总字数控制在 150-250 个汉字。
3. 不得给出具体剂量、频次、疗程数字，不得说"一日X片/每次X mg"。
4. 不得诊断、开处方、建议停换药或调整剂量。
5. 摘要面向医生，用于诊前快速了解患者用药情况，不是用药建议。
6. 不要结尾追问。

JSON 格式：
{"summary":"一句话概括患者近期用药情况","keyPoints":["最多3条关键发现"],"risks":["最多3条风险提示"],"nextAction":"下一步建议（指向诊间确认或联系医生）","warning":"提醒医生本摘要仅供参考"}

患者：${patient.name}${patient.age ? `，${patient.age}岁` : ''}${patient.gender ? `，${patient.gender}` : ''}${patient.conditions.length > 0 ? `，慢病：${patient.conditions.join('、')}` : ''}。
数据区间：${dateRange}（近 30 天）。

工具输出（均为只读计算结果）：
- 依从性：执行率 ${adherence.rate}%（已服 ${adherence.taken}/${adherence.total}），连续漏服 ${adherence.consecutiveSkip} 次${skipDetailsText}
- 用药清单（${medicationCount} 种）：${medicationNames.join('、')}
- 相互作用：${interactionsText}
- 临期库存：临期 ${expiry.expiringCount} 种、过期 ${expiry.expiredCount} 种、低库存 ${expiry.lowStockCount} 种
- 风险事件：L4 紧急 ${riskEvents.hasL4 ? '有' : '无'}、L3 拒答 ${riskEvents.hasL3 ? '有' : '无'}；咨询被拦截 ${riskEvents.blockedCount} 次；最近咨询："${riskEvents.lastQuestion}"

请基于以上事实生成诊前摘要。`

  return {
    model: process.env.BAICHUAN_MODEL ?? 'baichuan-m3-plus',
    temperature: 0.1,
    messages: [{ role: 'user' as const, content }],
  }
}

/** 医生端摘要：5 个只读工具输出 + 患者信息 → 结构化摘要。输出过 ConsultRawSectionsSchema safeParse。 */
export async function insightSummary(payload: InsightPromptPayload): Promise<ConsultRawSections> {
  const baseUrl = process.env.BAICHUAN_BASE_URL
  const key = process.env.BAICHUAN_API_KEY
  if (!baseUrl || !key) {
    throw new AIUnavailableError('baichuan', '缺少 BAICHUAN_BASE_URL / BAICHUAN_API_KEY 配置')
  }
  const res = await callJson<ChatResponse>(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(buildInsightRequest(payload)),
    },
    { client: 'baichuan' },
  )
  const raw = parseModelJson(extractChatContent(res, 'baichuan'), 'baichuan')
  const parsed = ConsultRawSectionsSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AIUnavailableError('baichuan', `医生端摘要输出不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}
