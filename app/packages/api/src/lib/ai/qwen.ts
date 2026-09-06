/**
 * Qwen3-VL 客户端（M2-T1）：层检测 + 身份线提取共用。
 * 请求体组装为独立纯函数（可测「只含约定字段」）；日志不打原文/图像。
 */
import { type LayerLabel } from '@anxin/shared'
import { AIUnavailableError, type IdentityFields, type ImageInput } from './types.js'
import { callJson, extractChatContent, parseModelJson, type ChatResponse } from './http.js'
import { IdentityExtractSchema, LayersOutputSchema } from './schemas.js'

const DETECT_PROMPT =
  '你是医疗单据层检测器。判断图像中包含哪些层，只输出一个 JSON 数组，元素取自：' +
  '["处方层","医院标签层","药盒原装层","说明书层","不支持"]。不要输出其它内容。'

const IDENTITY_PROMPT =
  '你是药品身份提取器。从图像提取药品身份字段，只输出一个 JSON 对象：' +
  '{"genericName":string 必填,"brandName"?:string,"specification"?:string,"form"?:string,' +
  '"manufacturer"?:string,"otcFlag"?:boolean,"approvalNumber"?:string}。' +
  '禁止输出任何用法用量/剂量/频次字段。不要输出其它内容。'

function dataUrl(image: ImageInput): string {
  return `data:${image.mime};base64,${image.base64}`
}

/** 层检测请求体（纯函数，可测）。 */
export function buildDetectLayersRequest(image: ImageInput) {
  return {
    model: process.env.QWEN_MODEL ?? 'qwen3-vl-plus',
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: DETECT_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl(image) } },
        ],
      },
    ],
  }
}

/** 身份提取请求体（纯函数，可测）。 */
export function buildExtractIdentityRequest(image: ImageInput) {
  return {
    model: process.env.QWEN_MODEL ?? 'qwen3-vl-plus',
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: IDENTITY_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl(image) } },
        ],
      },
    ],
  }
}

async function chatJson(body: object): Promise<unknown> {
  const baseUrl = process.env.QWEN_BASE_URL
  const key = process.env.QWEN_API_KEY
  if (!baseUrl || !key) throw new AIUnavailableError('qwen', '缺少 QWEN_BASE_URL / QWEN_API_KEY 配置')
  const res = await callJson<ChatResponse>(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    },
    { client: 'qwen' },
  )
  return parseModelJson(extractChatContent(res, 'qwen'), 'qwen')
}

export async function detectLayers(image: ImageInput): Promise<LayerLabel[]> {
  const raw = await chatJson(buildDetectLayersRequest(image))
  const parsed = LayersOutputSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AIUnavailableError('qwen', `层检测输出不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}

export async function extractIdentity(image: ImageInput): Promise<IdentityFields> {
  const raw = await chatJson(buildExtractIdentityRequest(image))
  const parsed = IdentityExtractSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AIUnavailableError('qwen', `身份提取输出不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}
