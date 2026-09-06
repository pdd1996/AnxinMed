/**
 * 管线测试用的 AiClients mock 工厂（M2-T6 + M3-T1 咨询）—— 非 .test.ts，不被 vitest 收集。
 *
 * 提供：mkOcr（把多行文本渲染成字符级 OCR 结果，复用 sanitize-crop.test.ts 的布局约定）、
 * mockClients（按 overrides 造 AiClients，支持错误注入 + 调用计数，验证降级与「OCR 未调用」）。
 *
 * M3-T1 扩展：consultAnswer / medicalSearch 默认抛 AIUnavailableError（明确失败，不静默通过）；
 * M2 管线测试不走咨询路径，故默认报错不影响现有测试；M3 咨询测试需显式 override。
 */
import type { LayerLabel } from '@anxin/shared'
import {
  AIUnavailableError,
  type AiClients,
  type ConsultPromptPayload,
  type ConsultRawSections,
  type FallbackFields,
  type IdentityFields,
  type ImageInput,
  type InsightPromptPayload,
  type OcrChar,
  type OcrResult,
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
  consultAnswer: number
  medicalSearch: number
  insightSummary: number
}

export function newCalls(): AiCalls {
  return {
    detectLayers: 0,
    runOcr: 0,
    extractIdentity: 0,
    fallbackParse: 0,
    consultAnswer: 0,
    medicalSearch: 0,
    insightSummary: 0,
  }
}

export interface MockOverrides {
  layers?: LayerLabel[]
  ocr?: OcrResult
  identity?: IdentityFields
  fallback?: FallbackFields
  /** M3-T1：咨询回答 override（未提供时默认抛 AIUnavailableError）。 */
  consult?: ConsultRawSections
  /** M3-T1：医疗搜索兜底 override。 */
  medical?: ConsultRawSections
  /** M3-T3：医生端摘要 override。 */
  insight?: ConsultRawSections
  detectLayersError?: Error
  runOcrError?: Error
  extractIdentityError?: Error
  fallbackError?: Error
  consultAnswerError?: Error
  medicalSearchError?: Error
  insightSummaryError?: Error
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
    async consultAnswer(_payload: ConsultPromptPayload) {
      calls.consultAnswer++
      if (o.consultAnswerError) throw o.consultAnswerError
      // 默认抛 AIUnavailableError：M2 管线测试不走咨询路径，如意外走到则明确失败（不静默通过）
      if (!o.consult) throw new AIUnavailableError('baichuan', 'mock 未提供 consultAnswer override')
      return o.consult
    },
    async medicalSearch(_question: string, _drugName: string) {
      calls.medicalSearch++
      if (o.medicalSearchError) throw o.medicalSearchError
      if (!o.medical) throw new AIUnavailableError('baichuan', 'mock 未提供 medicalSearch override')
      return o.medical
    },
    async insightSummary(_payload: InsightPromptPayload) {
      calls.insightSummary++
      if (o.insightSummaryError) throw o.insightSummaryError
      // 默认抛 AIUnavailableError：M2/M3-T1 测试不走摘要路径，如意外走到则明确失败（不静默通过）
      if (!o.insight) throw new AIUnavailableError('baichuan', 'mock 未提供 insightSummary override')
      return o.insight
    },
  }
}
