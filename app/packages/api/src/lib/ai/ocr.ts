/**
 * OCR 客户端：qwen3.5-ocr 云端 OpenAI 兼容端点（ADR 新条目取代 #13：弃 PaddleOCR 自托管）。
 * 行级转录（无字符级置信度/坐标）——prompt 要求逐行转录且不加任何注释；输出只做轻量规整
 * （strip Markdown 栅栏 / 逐行 trim / 去空行），过 OcrResultSchema 失败即 AIUnavailableError（不猜）。
 * 请求体组装为独立纯函数 buildOcrRequest（可测「只含约定字段」）；日志不打原文/图像。
 */
import { AIUnavailableError, type ImageInput, type OcrResult } from './types.js'
import { callJson, dataUrl, extractChatContent, type ChatResponse } from './http.js'
import { OcrResultSchema } from './schemas.js'

/** 转录 prompt（照抄 demo 原文）：保持行序 + 禁止注释/翻译/总结。 */
const TRANSCRIBE_PROMPT =
  '请逐行转录这张图片中的全部文字，保持原始行顺序，不要添加任何注释、翻译或总结。'

/** OCR 请求体（纯函数，可测）：OpenAI chat 形态，image_url 内嵌 dataURL。 */
export function buildOcrRequest(image: ImageInput) {
  return {
    model: process.env.OCR_MODEL ?? 'qwen3.5-ocr',
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: TRANSCRIBE_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl(image) } },
        ],
      },
    ],
  }
}

/** strip Markdown 代码栅栏（模型偶发用 ``` 包裹整段输出，只去首尾包裹不动正文）。 */
function stripCodeFence(content: string): string {
  return content.replace(/^```[a-zA-Z]*\r?\n?/, '').replace(/\r?\n?```\s*$/, '')
}

export async function runOcr(image: ImageInput): Promise<OcrResult> {
  const baseUrl = process.env.OCR_BASE_URL
  const key = process.env.OCR_API_KEY
  if (!baseUrl || !key) {
    throw new AIUnavailableError('ocr', '缺少 OCR_BASE_URL / OCR_API_KEY 配置（qwen3.5-ocr 云端端点）')
  }
  const res = await callJson<ChatResponse>(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(buildOcrRequest(image)),
    },
    { client: 'ocr', timeoutMs: 60_000 },
  )
  const content = extractChatContent(res, 'ocr')
  // 轻量规整：先 trim（防首尾空白使 ^ 锚定的栅栏正则失配）→ 去栅栏 → 逐行 trim → 去空行（行序保持）
  const lines = stripCodeFence(content.trim())
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const parsed = OcrResultSchema.safeParse({ lines })
  if (!parsed.success) {
    throw new AIUnavailableError('ocr', `OCR 转录为空或不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}
