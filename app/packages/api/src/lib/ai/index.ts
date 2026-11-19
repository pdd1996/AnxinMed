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
import { AIUnavailableError, type AiClients, type ConsultExternalKnowledgeOutput, type ConsultRawSections } from './types.js'
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
    externalKnowledge: externalKnowledgeClient,
    externalKnowledgeFallbacks,
  }
}

/**
 * 外部知识候选链（M14 演示版）：百川医疗 → 千问 → deepseek，按配置存在的模型入链。
 * 服务层逐个尝试，调用失败或输出安全清洗不过都换下一个——比单方法回落更稳（输出不合格也能降级）。
 */
function externalKnowledgeFallbacks(): Array<{
  label: string
  call: (question: string) => Promise<ConsultExternalKnowledgeOutput>
}> {
  const chain: Array<{ label: string; call: (question: string) => Promise<ConsultExternalKnowledgeOutput> }> = []
  if (process.env.BAICHUAN_API_KEY && process.env.BAICHUAN_BASE_URL) {
    chain.push({ label: process.env.BAICHUAN_MODEL ?? 'baichuan-m3-plus', call: baichuan.externalKnowledge })
  }
  if (process.env.QWEN_API_KEY) {
    chain.push({ label: process.env.CONSULT_MODEL || 'qwen3.8-flash', call: qwenText.externalKnowledge })
  }
  if (process.env.DEEPSEEK_API_KEY) {
    chain.push({ label: process.env.DEEPSEEK_MODEL || 'deepseek-flash', call: deepseek.externalKnowledge })
  }
  return chain
}

/**
 * 外部知识兜底模型选择（M14 演示版）：百川医疗模型优先；百川不可用（含 429 限流）自动回落千问文本，
 * 引用 version 由实际调用的模型返回（不冒充）；两者都不可用才抛错 → 上层固定通用提示。
 */
async function externalKnowledgeClient(question: string): Promise<ConsultExternalKnowledgeOutput> {
  const baichuanReady = Boolean(process.env.BAICHUAN_API_KEY && process.env.BAICHUAN_BASE_URL)
  const qwenReady = Boolean(process.env.QWEN_API_KEY)
  if (baichuanReady) {
    try {
      return await baichuan.externalKnowledge(question)
    } catch (e) {
      console.error('[ai] 百川外部知识调用失败，尝试千问回落：', e instanceof Error ? e.message : String(e))
      if (!qwenReady) throw e
    }
  }
  if (qwenReady) return qwenText.externalKnowledge(question)
  throw new AIUnavailableError('baichuan', '外部知识模型未配置（百川/千问均不可用）')
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
