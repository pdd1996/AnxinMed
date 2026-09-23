/**
 * Qwen 文本客户端（P0 · docs/13 §3.1/§4.1）——咨询/摘要/兜底解析的默认文本引擎。
 *
 * R4 强制非思考：`enable_thinking:false` + `preserve_thinking:false` 代码写死，不设 env 开关
 * （3.8 系列默认开思考且 preserve_thinking 默认 true，漏关会重复计费思维链并污染上下文）。
 * 响应侧断言（docs/13 §4.3 #2）：`reasoning_content` 非空即判失败（默认失败更安全，不做 strip 放行）。
 *
 * prompt 组装复用 baichuan.ts 的 build* 纯函数——同一套 prompt 才有对打可比性（docs/13 §3.1），
 * 本文件只覆盖请求参数（model / temperature=0 / JSON 约束 / 思考关闭）。
 */
import {
  AIUnavailableError,
  type ConsultPromptPayload,
  type ConsultRawSections,
  type FallbackFields,
  type InsightPromptPayload,
  type QueuePromptPayload,
} from './types.js'
import { callJson, extractChatContentStrict, parseModelJson, type ChatResponse } from './http.js'
import { ConsultRawSectionsSchema, FallbackParseSchema } from './schemas.js'
import {
  buildConsultRequest,
  buildFallbackParseRequest,
  buildInsightRequest,
  buildQueueSummaryRequest,
} from './baichuan.js'

/** 文本链公共请求参数（R4 写死）：CONSULT_MODEL 可覆盖默认模型（空串视同未设），思考必须关、温度必须 0。 */
function textRequest<T extends { messages: unknown }>(req: T) {
  return {
    ...req,
    model: process.env.CONSULT_MODEL || 'qwen3.8-flash',
    temperature: 0,
    response_format: { type: 'json_object' },
    // R4 强制非思考（代码写死）；preserve_thinking=false 防思维链回传重复计费/污染上下文
    enable_thinking: false,
    preserve_thinking: false,
  }
}

/** Qwen 文本链 chat：读 QWEN_BASE_URL/QWEN_API_KEY（与视觉链同账号同 key），严格取 content。 */
async function chatJson(req: unknown): Promise<unknown> {
  const baseUrl = process.env.QWEN_BASE_URL
  const key = process.env.QWEN_API_KEY
  if (!baseUrl || !key) {
    throw new AIUnavailableError('qwen-text', '缺少 QWEN_BASE_URL / QWEN_API_KEY 配置')
  }
  const res = await callJson<ChatResponse>(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(req),
    },
    { client: 'qwen-text' },
  )
  return parseModelJson(extractChatContentStrict(res, 'qwen-text'), 'qwen-text')
}

/** 咨询回答：本地说明书 + 相互作用上下文 → 结构化分区（与 baichuan.consultAnswer 同 prompt 同 schema）。 */
export async function consultAnswer(payload: ConsultPromptPayload): Promise<ConsultRawSections> {
  const raw = await chatJson(textRequest(buildConsultRequest(payload)))
  const parsed = ConsultRawSectionsSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AIUnavailableError('qwen-text', `咨询回答输出不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}

/** 兜底解析（与 baichuan.fallbackParse 同 prompt 同 schema）。 */
export async function fallbackParse(bodyText: string, missingFields: string[]): Promise<FallbackFields> {
  const raw = await chatJson(textRequest(buildFallbackParseRequest(bodyText, missingFields)))
  const parsed = FallbackParseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AIUnavailableError('qwen-text', `兜底解析输出不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}

/** 医生端摘要（与 baichuan.insightSummary 同 prompt 同 schema）。 */
export async function insightSummary(payload: InsightPromptPayload): Promise<ConsultRawSections> {
  const raw = await chatJson(textRequest(buildInsightRequest(payload)))
  const parsed = ConsultRawSectionsSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AIUnavailableError('qwen-text', `医生端摘要输出不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}

/** 队列摘要（与 baichuan.queueSummary 同 prompt 同 schema）。 */
export async function queueSummary(payload: QueuePromptPayload): Promise<ConsultRawSections> {
  const raw = await chatJson(textRequest(buildQueueSummaryRequest(payload)))
  const parsed = ConsultRawSectionsSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AIUnavailableError('qwen-text', `队列摘要输出不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}
