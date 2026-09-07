/**
 * OCR 客户端：qwen3.5-ocr 云端 OpenAI 兼容端点（ADR 新条目取代 #13：弃 PaddleOCR 自托管）。
 * 行级契约 OcrResult = { lines }（无字符级置信度/坐标）——prompt 要求逐行转录且不加任何注释，
 * 但端点强制返回坐标标注的结构化输出（prompt 约束无效，2026-09-07 线上实测，ADR #16 补记），
 * ocrContentToLines 在客户端解包丢弃坐标、恢复纯文本行；过 OcrResultSchema 失败即
 * AIUnavailableError（不猜）。请求体组装为独立纯函数 buildOcrRequest（可测「只含约定字段」）；日志不打原文/图像。
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

/** B 形态行首坐标前缀：`x,y,w,h,angle,`——恰 5 组数字+逗号；文本自身含逗号不受影响（只剥定长前缀）。 */
const COORD_PREFIX_RE = /^(?:\d+(?:\.\d+)?,){5}/

/** A 形态数组元素 → 其 text（纯字符串元素原样取；无 text 的元素返回 null，视同空转录）。 */
function textOf(el: unknown): string | null {
  if (typeof el === 'string') return el
  if (el !== null && typeof el === 'object' && typeof (el as { text?: unknown }).text === 'string') {
    return (el as { text: string }).text
  }
  return null
}

/**
 * 端点输出 → 行级纯文本（2026-09-07 线上格式漂移修复）。
 * 端点无视 prompt，强制给每行文字附带坐标标注，实测两种形态：
 *   A. ```json 栅栏包裹的数组：`[{"rotate_rect": [x,y,w,h,angle], "text": "…"}, …]`（合法 JSON，可直接 parse）
 *   B. 裸 CSV 行：`x,y,w,h,angle,text`
 * 解包规则：栅栏剥离后 JSON.parse 成功且为数组 → 取各元素 text（数组即解包定论，全空 → 空转录，
 * 上层 safeParse 拒绝不猜）；其余走行级规整（逐行 trim / 去空行）并剥 B 形态行首坐标前缀。
 * 坐标一律丢弃不保留——OcrResult 行级契约不变（sanitize 按行索引裁剪，锚点严格等值判定）。
 */
export function ocrContentToLines(content: string): string[] {
  const stripped = stripCodeFence(content.trim())
  try {
    const arr: unknown = JSON.parse(stripped)
    if (Array.isArray(arr)) {
      return arr
        .map(textOf)
        .filter((t): t is string => t !== null && t.trim().length > 0)
        .map((t) => t.trim())
    }
  } catch {
    // 非 JSON（B 形态 / 纯文本）→ 落到行级规整
  }
  return stripped
    .split(/\r?\n/)
    .map((l) => l.trim().replace(COORD_PREFIX_RE, ''))
    .filter((l) => l.length > 0)
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
  // 端点结构化输出解包（A/B 形态）→ 行级纯文本，再过闭合 schema
  const lines = ocrContentToLines(content)
  const parsed = OcrResultSchema.safeParse({ lines })
  if (!parsed.success) {
    throw new AIUnavailableError('ocr', `OCR 转录为空或不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}
