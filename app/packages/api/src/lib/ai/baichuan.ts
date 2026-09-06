/**
 * Baichuan-M3-Plus 客户端（M2-T1）：仅用于「兜底解析」（正则解析有缺项时触发；咨询在 M3 强化）。
 * 发给模型的内容只含 L0 裁剪后的白名单文本（不含图像/PII 之外内容），由请求体组装单测保证。
 */
import { AIUnavailableError, type FallbackFields } from './types.js'
import { callJson, extractChatContent, parseModelJson, type ChatResponse } from './http.js'
import { FallbackParseSchema } from './schemas.js'

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
