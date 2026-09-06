/**
 * OCR 客户端（M2-T1）：按 M1-T11 定案使用 PaddleOCR 自托管。
 * Node 进程内不跑 Paddle（Python），故以 HTTP 调用自托管 PaddleOCR 服务（OCR_BASE_URL，
 * 生产为 compose/侧车容器）。输出统一 OcrResult（字符级置信度 + 坐标，硬要求）。
 */
import { AIUnavailableError, type ImageInput, type OcrResult } from './types.js'
import { callJson } from './http.js'
import { OcrResultSchema } from './schemas.js'

/** OCR 请求体（纯函数，可测）。只传图像 base64。 */
export function buildOcrRequest(image: ImageInput) {
  return { image: image.base64, mime: image.mime }
}

export async function runOcr(image: ImageInput): Promise<OcrResult> {
  const baseUrl = process.env.OCR_BASE_URL
  if (!baseUrl) {
    throw new AIUnavailableError('ocr', '缺少 OCR_BASE_URL 配置（PaddleOCR 自托管服务地址）')
  }
  const res = await callJson<unknown>(
    `${baseUrl.replace(/\/$/, '')}/ocr`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildOcrRequest(image)),
    },
    { client: 'ocr' },
  )
  const parsed = OcrResultSchema.safeParse(res)
  if (!parsed.success) {
    throw new AIUnavailableError('ocr', `OCR 响应不符合约定：${parsed.error.message}`)
  }
  return parsed.data
}
