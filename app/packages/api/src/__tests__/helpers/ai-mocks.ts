/**
 * 管线测试用的 AiClients mock 工厂（M2-T6 + M3-T1 咨询）—— 非 .test.ts，不被 vitest 收集。
 *
 * 提供：mkOcr（把多行文本包装成行级 OCR 结果，qwen3.5-ocr 契约：lines 纯文本）、
 * mockClients（按 overrides 造 AiClients，支持错误注入 + 调用计数，验证降级与「OCR 未调用」）。
 *
 * M3-T1 扩展：consultAnswer 默认抛 AIUnavailableError（明确失败，不静默通过）；
 * M2 管线测试不走咨询路径，故默认报错不影响现有测试；M3 咨询测试需显式 override。
 */
import type { LayerLabel } from '@anxin/shared'
import {
  AIUnavailableError,
  type AiClients,
  type ConsultPromptPayload,
  type ConsultRawSections,
  type DetectIdentityResult,
  type FallbackFields,
  type IdentityFields,
  type ImageInput,
  type InsightPromptPayload,
  type OcrResult,
  type QueuePromptPayload,
} from '../../lib/ai/types.js'

/** 行级 OCR 结果：直接传行数组（无置信度/坐标，诚实契约）。 */
export function mkOcr(lines: string[]): OcrResult {
  return { lines }
}

/** 测试图像（mock 客户端不解析内容，仅需通过 dataURL 校验/占位）。 */
export const IMG: ImageInput = { base64: 'QUJD', mime: 'image/png' }
export const IMG_DATAURL = 'data:image/png;base64,QUJD'

/** 各客户端调用计数（供「OCR 未被调用」等结构断言）。 */
export interface AiCalls {
  detectLayers: number
  /** 入口B 合并调用（层检测+身份）次数。 */
  detectIdentity: number
  runOcr: number
  extractIdentity: number
  fallbackParse: number
  consultAnswer: number
  insightSummary: number
  queueSummary: number
}

export function newCalls(): AiCalls {
  return {
    detectLayers: 0,
    detectIdentity: 0,
    runOcr: 0,
    extractIdentity: 0,
    fallbackParse: 0,
    consultAnswer: 0,
    insightSummary: 0,
    queueSummary: 0,
  }
}

export interface MockOverrides {
  layers?: LayerLabel[]
  ocr?: OcrResult
  identity?: IdentityFields
  /** 入口B 合并调用返回值（显式覆盖）。未给时按 layers + identity 组合，identity 缺省为 {genericName:''}。 */
  detectIdentity?: DetectIdentityResult
  fallback?: FallbackFields
  /** M3-T1：咨询回答 override（未提供时默认抛 AIUnavailableError）。 */
  consult?: ConsultRawSections
  /** M3-T3：医生端摘要 override。 */
  insight?: ConsultRawSections
  /** T7：队列摘要 override。 */
  queue?: ConsultRawSections
  detectLayersError?: Error
  detectIdentityError?: Error
  runOcrError?: Error
  extractIdentityError?: Error
  fallbackError?: Error
  consultAnswerError?: Error
  insightSummaryError?: Error
  queueSummaryError?: Error
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
    /**
     * 入口B 合并调用：默认按 layers + identity 组合（既有用例零改动）；
     * detectLayersError 优先抛（硬闸门不可用语义）；detectIdentityError 单独注入；
     * extractIdentityError 时返回 identity=null（身份读不出 → needsManual 降级，与真实实现同构）。
     */
    async detectAndExtractIdentity() {
      calls.detectIdentity++
      if (o.detectIdentityError) throw o.detectIdentityError
      if (o.detectLayersError) throw o.detectLayersError
      if (o.detectIdentity) return o.detectIdentity
      const identity = o.extractIdentityError ? null : (o.identity ?? { genericName: '' })
      return { layers: o.layers ?? ['处方层'], identity }
    },
    async runOcr() {
      calls.runOcr++
      if (o.runOcrError) throw o.runOcrError
      return o.ocr ?? { lines: [] }
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
      if (!o.consult) throw new AIUnavailableError('qwen-text', 'mock 未提供 consultAnswer override')
      return o.consult
    },
    async insightSummary(_payload: InsightPromptPayload) {
      calls.insightSummary++
      if (o.insightSummaryError) throw o.insightSummaryError
      // 默认抛 AIUnavailableError：M2/M3-T1 测试不走摘要路径，如意外走到则明确失败（不静默通过）
      if (!o.insight) throw new AIUnavailableError('qwen-text', 'mock 未提供 insightSummary override')
      return o.insight
    },
    async queueSummary(_payload: QueuePromptPayload) {
      calls.queueSummary++
      if (o.queueSummaryError) throw o.queueSummaryError
      // 默认抛 AIUnavailableError：不走队列摘要路径的测试如意外走到则明确失败（不静默通过）
      if (!o.queue) throw new AIUnavailableError('qwen-text', 'mock 未提供 queueSummary override')
      return o.queue
    },
  }
}
