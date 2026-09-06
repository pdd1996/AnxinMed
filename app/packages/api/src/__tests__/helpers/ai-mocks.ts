/**
 * 管线测试用的 AiClients mock 工厂（M2-T6）—— 非 .test.ts，不被 vitest 收集。
 *
 * 提供：mkOcr（把多行文本渲染成字符级 OCR 结果，复用 sanitize-crop.test.ts 的布局约定）、
 * mockClients（按 overrides 造 AiClients，支持错误注入 + 调用计数，验证降级与「OCR 未调用」）。
 */
import type { LayerLabel } from '@anxin/shared'
import type {
  AiClients,
  FallbackFields,
  IdentityFields,
  ImageInput,
  OcrChar,
  OcrResult,
} from '../../lib/ai/types.js'

/** 把多行文本渲染成字符级 OCR 结果：每行 y=行号×30，字符宽 16 高 20，行内 x 递增。 */
export function mkOcr(lines: string[], confidence = 0.99): OcrResult {
  const chars: OcrChar[] = []
  lines.forEach((line, li) => {
    const y = li * 30
    let x = 10
    for (const ch of line) {
      chars.push({ text: ch, confidence, box: { x, y, w: 16, h: 20 } })
      x += 16
    }
  })
  return { chars }
}

/** 测试图像（mock 客户端不解析内容，仅需通过 dataURL 校验/占位）。 */
export const IMG: ImageInput = { base64: 'QUJD', mime: 'image/png' }
export const IMG_DATAURL = 'data:image/png;base64,QUJD'

/** 各客户端调用计数（供「OCR 未被调用」等结构断言）。 */
export interface AiCalls {
  detectLayers: number
  runOcr: number
  extractIdentity: number
  fallbackParse: number
}

export function newCalls(): AiCalls {
  return { detectLayers: 0, runOcr: 0, extractIdentity: 0, fallbackParse: 0 }
}

export interface MockOverrides {
  layers?: LayerLabel[]
  ocr?: OcrResult
  identity?: IdentityFields
  fallback?: FallbackFields
  detectLayersError?: Error
  runOcrError?: Error
  extractIdentityError?: Error
  fallbackError?: Error
  calls?: AiCalls
}

/** 造 AiClients mock：默认层=处方层、ocr=空、identity=空名；overrides 覆盖，*Error 注入抛错。 */
export function mockClients(o: MockOverrides = {}): AiClients {
  const calls = o.calls ?? newCalls()
  return {
    async detectLayers() {
      calls.detectLayers++
      if (o.detectLayersError) throw o.detectLayersError
      return o.layers ?? ['处方层']
    },
    async runOcr() {
      calls.runOcr++
      if (o.runOcrError) throw o.runOcrError
      return o.ocr ?? { chars: [] }
    },
    async extractIdentity() {
      calls.extractIdentity++
      if (o.extractIdentityError) throw o.extractIdentityError
      return o.identity ?? { genericName: '' }
    },
    async fallbackParse() {
      calls.fallbackParse++
      if (o.fallbackError) throw o.fallbackError
      return o.fallback ?? {}
    },
  }
}
