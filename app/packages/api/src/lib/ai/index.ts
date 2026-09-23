/**
 * AI 客户端组装（M2-T1 + M3-T1 咨询 + P0 文本链分装）。生产用 createAiClients() 得到真实实现；
 * 测试 / E2E 直接注入 mock 或 FixtureAiClients（实现 AiClients 接口），管线 run.ts 不感知差异。
 *
 * 文本链按 CONSULT_PROVIDER 分装（P0 · docs/13 §3.1）：
 *   qwen（默认） → qwen-text.ts（qwen3.8-flash 非思考）
 *   deepseek     → deepseek.ts 仅 consultAnswer（对照档）；fallbackParse/摘要仍走 qwen-text
 *   baichuan     → baichuan.ts 全量文本方法（回滚通道：CONSULT_PROVIDER=baichuan 一键回退）
 * 视觉链（detectLayers/extractIdentity/runOcr）恒走 qwen/ocr，不随 provider 切换。
 */
import type { AiClients } from './types.js'
import * as qwen from './qwen.js'
import * as ocr from './ocr.js'
import * as baichuan from './baichuan.js'
import * as qwenText from './qwen-text.js'
import * as deepseek from './deepseek.js'

/** 当前 CONSULT_PROVIDER（缺省 qwen；未知值按 qwen 处理，不静默换行为）。 */
export function consultProvider(): 'qwen' | 'deepseek' | 'baichuan' {
  const p = String(process.env.CONSULT_PROVIDER ?? 'qwen').toLowerCase()
  return p === 'deepseek' ? 'deepseek' : p === 'baichuan' ? 'baichuan' : 'qwen'
}

/** 文本链是否已配置 key（insight LLM 门控用）：deepseek 对照下摘要仍走 qwen-text，需两把 key。 */
export function isTextProviderConfigured(): boolean {
  const provider = consultProvider()
  if (provider === 'baichuan') return Boolean(process.env.BAICHUAN_API_KEY)
  if (provider === 'deepseek') return Boolean(process.env.DEEPSEEK_API_KEY) && Boolean(process.env.QWEN_API_KEY)
  return Boolean(process.env.QWEN_API_KEY)
}

export function createAiClients(): AiClients {
  const provider = consultProvider()
  const consultAnswer =
    provider === 'deepseek'
      ? deepseek.consultAnswer
      : provider === 'baichuan'
        ? baichuan.consultAnswer
        : qwenText.consultAnswer
  const rest = provider === 'baichuan' ? baichuan : qwenText
  return {
    detectLayers: qwen.detectLayers,
    extractIdentity: qwen.extractIdentity,
    runOcr: ocr.runOcr,
    fallbackParse: rest.fallbackParse,
    consultAnswer,
    insightSummary: rest.insightSummary,
    queueSummary: rest.queueSummary,
  }
}

export * from './types.js'
export { buildDetectLayersRequest, buildExtractIdentityRequest } from './qwen.js'
export { buildOcrRequest } from './ocr.js'
export {
  buildFallbackParseRequest,
  buildConsultRequest,
  buildInsightRequest,
  buildQueueSummaryRequest,
} from './baichuan.js'
export { buildDeepseekConsultRequest } from './deepseek.js'
