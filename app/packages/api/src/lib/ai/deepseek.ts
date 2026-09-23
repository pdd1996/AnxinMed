/**
 * DeepSeek 对照客户端（P0 · docs/13 §3.1/§4.2）——deepseek-flash 关思考做咨询对照，小流量，
 * golden 对打全面优于或持平 qwen3.8-flash 才允许切默认（§6.2 门槛）。
 * R4 强制非思考：`thinking:{type:'disabled'}` 代码写死，不传 reasoning_effort
 * （DeepSeek 官方默认思考 + effort=high，漏关即用推理模型做抄写：又慢又越权）。
 * prompt 复用 baichuan.ts 的 buildConsultRequest（同一套 prompt，对打可比）。
 */
import { AIUnavailableError, type ConsultPromptPayload, type ConsultRawSections } from './types.js'
import { callJson, extractChatContentStrict, parseModelJson, type ChatResponse } from './http.js'
import { ConsultRawSectionsSchema } from './schemas.js'
import { buildConsultRequest } from './baichuan.js'

/** 对照请求体（纯函数，可测）：同 prompt，model/temperature/思考关闭按 DeepSeek 契约覆盖。 */
export function buildDeepseekConsultRequest(payload: ConsultPromptPayload) {
  return {
    ...buildConsultRequest(payload),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    temperature: 0,
    thinking: { type: 'disabled' },
  }
}

/** 咨询回答（对照档）：未配置 DEEPSEEK_API_KEY 抛 AIUnavailableError，上层转降级（失败可见）。 */
export async function consultAnswer(payload: ConsultPromptPayload): Promise<ConsultRawSections> {
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) {
    throw new AIUnavailableError('deepseek', '缺少 DEEPSEEK_API_KEY 配置（deepseek 对照档）')
  }
  const res = await callJson<ChatResponse>(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(buildDeepseekConsultRequest(payload)),
    },
    { client: 'deepseek' },
  )
  const raw = parseModelJson(extractChatContentStrict(res, 'deepseek'), 'deepseek')
  const parsed = ConsultRawSectionsSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AIUnavailableError('deepseek', `咨询回答输出不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}
