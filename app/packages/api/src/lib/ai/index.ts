/**
 * AI 客户端组装（M2-T1 + M3-T1 咨询）。生产用 createAiClients() 得到真实实现；
 * 测试 / E2E 直接注入 mock 或 FixtureAiClients（实现 AiClients 接口），管线 run.ts 不感知差异。
 */
import type { AiClients } from './types.js'
import * as qwen from './qwen.js'
import * as ocr from './ocr.js'
import * as baichuan from './baichuan.js'

export function createAiClients(): AiClients {
  return {
    detectLayers: qwen.detectLayers,
    extractIdentity: qwen.extractIdentity,
    runOcr: ocr.runOcr,
    fallbackParse: baichuan.fallbackParse,
    consultAnswer: baichuan.consultAnswer,
    medicalSearch: baichuan.medicalSearch,
    insightSummary: baichuan.insightSummary,
    queueSummary: baichuan.queueSummary,
  }
}

export * from './types.js'
export { buildDetectLayersRequest, buildExtractIdentityRequest } from './qwen.js'
export { buildOcrRequest } from './ocr.js'
export {
  buildFallbackParseRequest,
  buildConsultRequest,
  buildMedicalSearchRequest,
  buildInsightRequest,
  buildQueueSummaryRequest,
} from './baichuan.js'
