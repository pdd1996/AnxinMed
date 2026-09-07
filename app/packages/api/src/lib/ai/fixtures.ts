/**
 * Fixture 回放客户端（M2-T10）—— `FixtureAiClients implements AiClients`。
 *
 * E2E 进程以 `AI_MODE=fixtures` 启动 api；每个请求经 `x-test-scenario` 头（AsyncLocalStorage，见 scenario.ts）
 * 选定场景，从 `app/e2e/fixtures/<scenario>.json` 回放**录制好的模型逐步原始响应**（层检测/OCR/VLM 身份/兜底）。
 * 编排、降级、回链、脱敏、事务、API 全走真代码，只冻结模型 I/O —— CI 无 key 可复现。
 *
 * 同时记录各方法调用计数（aiCallLog），供 E2E 断言「unsupported-loose-pills 时 OCR 未被调用」等结构红线。
 * fixture 包由 e2e/scripts/make-fixtures.ts 从 golden-cases.json 生成（合成 oracle），
 * 或有 key 环境以 AI_MODE=record 重录（换 prompt/换模型版本时重录并重审）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
  type OcrResult,
  type QueuePromptPayload,
} from './types.js'
import { currentScenario } from './scenario.js'

/** 单个场景的录制包（模型 I/O 冻结件）。 */
export interface FixturePack {
  scenario: string
  entry: 'A' | 'B'
  source: 'synthetic' | 'live'
  detectLayers: LayerLabel[]
  extractIdentity: IdentityFields | null
  runOcr: OcrResult | null
  fallbackParse: FallbackFields | null
  /** M3-T1 咨询回答录制（可选：M2 fixture 包无此字段，走咨询路径明确抛错，不静默通过）。 */
  consultAnswer?: ConsultRawSections | null
  /** M3-T1 医疗搜索兜底录制（可选）。 */
  medicalSearch?: ConsultRawSections | null
  /** M3-T3 医生端摘要录制（可选）。 */
  insightSummary?: ConsultRawSections | null
  /** T7 队列摘要录制（可选）。 */
  queueSummary?: ConsultRawSections | null
}

/** app/e2e/fixtures（从本文件 app/packages/api/src/lib/ai/ 上溯 5 级到 app/）。 */
const FIXTURE_DIR = fileURLToPath(new URL('../../../../../e2e/fixtures', import.meta.url))

const packCache = new Map<string, FixturePack>()

export function loadPack(scenario: string): FixturePack {
  const cached = packCache.get(scenario)
  if (cached) return cached
  const file = `${FIXTURE_DIR}/${scenario}.json`
  if (!scenario || !existsSync(file)) {
    throw new AIUnavailableError('qwen', `fixture 场景不存在：${scenario || '(缺 x-test-scenario 头)'}（期望 ${file}）`)
  }
  const pack = JSON.parse(readFileSync(file, 'utf-8')) as FixturePack
  packCache.set(scenario, pack)
  return pack
}

/** 各方法调用计数（按场景）——供「OCR 未调用」等结构断言。 */
export interface AiCallCounts {
  detectLayers: number
  runOcr: number
  extractIdentity: number
  fallbackParse: number
  consultAnswer: number
  medicalSearch: number
  insightSummary: number
  queueSummary: number
}
const callLog = new Map<string, AiCallCounts>()
export function aiCallLog(scenario: string): AiCallCounts {
  return (
    callLog.get(scenario) ?? {
      detectLayers: 0,
      runOcr: 0,
      extractIdentity: 0,
      fallbackParse: 0,
      consultAnswer: 0,
      medicalSearch: 0,
      insightSummary: 0,
      queueSummary: 0,
    }
  )
}
function bump(scenario: string, method: keyof AiCallCounts) {
  const cur = aiCallLog(scenario)
  callLog.set(scenario, { ...cur, [method]: cur[method] + 1 })
}

/** 回放实现：只读录制包 + 记调用计数，不做任何真实网络调用。 */
export class FixtureAiClients implements AiClients {
  async detectLayers(_image: ImageInput): Promise<LayerLabel[]> {
    const s = currentScenario()
    bump(s, 'detectLayers')
    return loadPack(s).detectLayers
  }
  async extractIdentity(_image: ImageInput): Promise<IdentityFields> {
    const s = currentScenario()
    bump(s, 'extractIdentity')
    const identity = loadPack(s).extractIdentity
    if (!identity) throw new AIUnavailableError('qwen', `fixture ${s} 无身份录制`)
    return identity
  }
  async runOcr(_image: ImageInput): Promise<OcrResult> {
    const s = currentScenario()
    bump(s, 'runOcr')
    const ocr = loadPack(s).runOcr
    if (!ocr) throw new AIUnavailableError('ocr', `fixture ${s} 无 OCR 录制`)
    return ocr
  }
  async fallbackParse(_bodyText: string, _missingFields: string[]): Promise<FallbackFields> {
    const s = currentScenario()
    bump(s, 'fallbackParse')
    return loadPack(s).fallbackParse ?? {}
  }
  async consultAnswer(_payload: ConsultPromptPayload): Promise<ConsultRawSections> {
    const s = currentScenario()
    bump(s, 'consultAnswer')
    const raw = loadPack(s).consultAnswer
    // M2 fixture 包无此字段 → 明确抛错（不静默通过）；M3 咨询 E2E 录制时补上即可回放。
    if (!raw) throw new AIUnavailableError('baichuan', `fixture ${s} 无咨询回答录制`)
    return raw
  }
  async medicalSearch(_question: string, _drugName: string): Promise<ConsultRawSections> {
    const s = currentScenario()
    bump(s, 'medicalSearch')
    const raw = loadPack(s).medicalSearch
    if (!raw) throw new AIUnavailableError('baichuan', `fixture ${s} 无医疗搜索录制`)
    return raw
  }
  async insightSummary(_payload: InsightPromptPayload): Promise<ConsultRawSections> {
    const s = currentScenario()
    bump(s, 'insightSummary')
    const raw = loadPack(s).insightSummary
    // M2/M3-T1 fixture 包无此字段 → 明确抛错（不静默通过）；M3-T3 摘要 E2E 录制时补上即可回放。
    if (!raw) throw new AIUnavailableError('baichuan', `fixture ${s} 无医生端摘要录制`)
    return raw
  }
  async queueSummary(_payload: QueuePromptPayload): Promise<ConsultRawSections> {
    const s = currentScenario()
    bump(s, 'queueSummary')
    const raw = loadPack(s).queueSummary
    // 无录制的场景包 → 明确抛错（编排层转 error-fallback，不静默通过）；T7 队列 E2E 录制时补上即可回放。
    if (!raw) throw new AIUnavailableError('baichuan', `fixture ${s} 无队列摘要录制`)
    return raw
  }
}
