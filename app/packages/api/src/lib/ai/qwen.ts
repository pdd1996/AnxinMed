/**
 * Qwen3-VL 客户端（M2-T1）：层检测 + 身份线提取共用。
 * 请求体组装为独立纯函数（可测「只含约定字段」）；日志不打原文/图像。
 */
import { type LayerLabel } from '@anxin/shared'
import { AIUnavailableError, type DetectIdentityResult, type IdentityFields, type ImageInput } from './types.js'
import { callJson, dataUrl, extractChatContent, parseModelJson, type ChatResponse } from './http.js'
import { DetectIdentityEnvelopeSchema, IdentityExtractSchema, LayersOutputSchema } from './schemas.js'

const DETECT_PROMPT =
  '你是医疗单据层检测器。判断图像中包含哪些层，只输出一个 JSON 数组，元素取自：' +
  '["处方层","医院标签层","药盒原装层","说明书层","不支持"]。不要输出其它内容。'

const IDENTITY_PROMPT =
  '你是药品身份提取器。从图像提取药品身份字段，所有字段必须来自图像中**可见文字**；' +
  '图像里看不到的字段一律省略，禁止凭记忆、常识或训练知识补全（尤其批准文号/厂家/规格），不输出 null。' +
  '只输出一个 JSON 对象：' +
  '{"genericName":string 必填,"brandName"?:string,"specification"?:string,"form"?:string,' +
  '"manufacturer"?:string,"otcFlag"?:boolean,"approvalNumber"?:string}。' +
  '禁止输出任何用法用量/剂量/频次字段。不要输出其它内容。'

/**
 * 入口B 合并调用 prompt（「拍药品」延迟优化）：一次模型往返同时给层标签与身份字段。
 * 三条约束与拆开时逐字一致：①层标签只允许 5 个字面量；②仅药品包装层才提取身份（否则 identity=null，
 * 散装药片/处方笺不进入身份提取）；③禁止输出任何用法用量字段（PRD V2.1 边界）。
 *
 * 措辞取「detect prompt 原句 + 补充」而不是全新两段式：2026-11-19 live 对拍发现，全新措辞会把
 * 散装药片样张误判成「处方层」（闸门给错纠偏建议）；补一句「不支持=散装/裸药片、处方笺=处方层」后
 * 与拆开的 detect prompt 判定一致（12/12 与对拍样张一致）。
 */
const DETECT_IDENTITY_PROMPT =
  '你是医疗单据识别器。先判断图像中包含哪些层：输出 layers 数组，元素只能逐字取自：' +
  '["处方层","医院标签层","药盒原装层","说明书层","不支持"]。' +
  '注意：「不支持」指散装药片、裸药片、无包装信息的物体；处方笺是「处方层」。' +
  '若 layers 含「药盒原装层」或「医院标签层」，再提取药品身份字段放进 identity，否则 identity 为 null。' +
  'identity 所有字段必须来自图像中**可见文字**；图像里看不到的字段一律省略，' +
  '禁止凭记忆、常识或训练知识补全（尤其批准文号/厂家/规格），不输出 null。' +
  '只输出一个 JSON 对象：{"layers":[...],"identity":{"genericName":string 必填,"brandName"?:string,' +
  '"specification"?:string,"form"?:string,"manufacturer"?:string,"otcFlag"?:boolean,' +
  '"approvalNumber"?:string} 或 null}。禁止输出任何用法用量/剂量/频次字段。不要输出其它内容。'

/** 层检测请求体（纯函数，可测）。dataURL 由 http.ts 统一导出（与 ocr 共用）。 */
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

/** 入口B 合并请求体（纯函数，可测；与拆开的两份请求同形，只换 prompt）。 */
export function buildDetectIdentityRequest(image: ImageInput) {
  return {
    model: process.env.QWEN_MODEL ?? 'qwen3-vl-plus',
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: DETECT_IDENTITY_PROMPT },
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

/**
 * 入口B：层检测 + 身份提取合并为单次调用（拍药盒链路少一次模型往返）。
 *
 * 解析纪律：layers 严格（闸门依据，非法即 AIUnavailableError，不猜）；
 * identity 宽松（缺省/null/无合法 genericName → 视为 null，由 pipeline 转 needsManual 降级，
 * 不把「身份读不出」误报成「模型不可用」——409/422 闸门仍依赖同一响应里的 layers）。
 */
export async function detectAndExtractIdentity(image: ImageInput): Promise<DetectIdentityResult> {
  const raw = await chatJson(buildDetectIdentityRequest(image))
  const envelope = DetectIdentityEnvelopeSchema.safeParse(raw)
  if (!envelope.success) {
    throw new AIUnavailableError('qwen', `层检测输出不符合约定：${envelope.error.message}`)
  }
  const identity = IdentityExtractSchema.safeParse(envelope.data.identity)
  return { layers: envelope.data.layers, identity: identity.success ? identity.data : null }
}
