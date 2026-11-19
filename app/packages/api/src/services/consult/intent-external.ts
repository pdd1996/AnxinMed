/**
 * 外部知识意图的模型兜底（M14 · A12/A13 数据驱动的最小实现）。
 *
 * 背景：外部兜底的触发是纯正则（external.ts 的 SUBSTANCE/COUSE/HINT），说法一变就漏——
 *   「酒和头孢能吃吗」「头孢配酒可以吗」都不命中（词表只有「一起吃/能喝酒」）。
 *   本模块在「规则判不了 + 出现非药品物质词」时调一次 DeepSeek 做**二值意图判定**，
 *   只用于把问题送进外部兜底分支；不改 S1/S2 路由（模型的 S2 判断只观测不采纳）。
 *
 * 纪律（与 M13-P3「不接线上」结论兼容）：
 * - 规则永远优先：规则已命中/已否决时不调模型；
 * - 模型输出必须过 zod 枚举校验，坏 JSON/超时/失败 → false（回落规则结果，不阻塞、不改道）；
 * - 「不确定选 S1」写进 prompt：宁可漏掉也不把普通问题拉进模型回答层；
 * - 只发脱敏问题文本，不写库；调用统计走 lib/ai/http.ts 的 recordModelCall；
 * - `ENABLE_INTENT_MODEL=false` 整体回滚；`INTENT_MODEL_TIMEOUT_MS` 默认 2500ms。
 */
import { z } from 'zod'
import {
  callJson,
  extractChatContentStrict,
  parseModelJson,
  type ChatResponse,
} from '../../lib/ai/http.js'
import { SUBSTANCE_PATTERN } from './external.js'

/** 模型分类标签（仅内部使用；不写入 shared 契约，避免客户端枚举扩散）。 */
export const EXTERNAL_INTENT_LABEL = 'external-substance-interaction'

/** 模型输出枚举：与 M13-P3 评测的 6 类一致，另加外部知识 1 类（共 7 类）。 */
export const INTENT_CLASSES = [
  'S1',
  'medication-list',
  'adherence',
  'expiry-stock',
  'interaction-check',
  'next-dose',
  EXTERNAL_INTENT_LABEL,
] as const

const ModelIntentSchema = z.object({ intent: z.enum(INTENT_CLASSES) })

/** 判定结果：仅 external 会改变路由；not-external/null 均等价于「规则说了算」。 */
export type ExternalIntentVerdict = 'external' | 'not-external'

/** 可注入分类器（测试/离线评测替换默认 DeepSeek 实现）。 */
export type ExternalIntentClassifier = (question: string) => Promise<ExternalIntentVerdict | null>

let injectedClassifier: ExternalIntentClassifier | null = null

/** 测试注入分类器；传 null 恢复默认 DeepSeek 实现。返回旧值（便于 afterAll 还原）。 */
export function setExternalIntentClassifier(fn: ExternalIntentClassifier | null): ExternalIntentClassifier | null {
  const prev = injectedClassifier
  injectedClassifier = fn
  return prev
}

/** 模型兜底开关（默认开；`ENABLE_INTENT_MODEL=false` 回滚到纯规则）。 */
export function isIntentModelEnabled(): boolean {
  return String(process.env.ENABLE_INTENT_MODEL ?? '').toLowerCase() !== 'false'
}

/**
 * 候选门控：只有出现「非药品物质词」（酒/西柚/咖啡/茶/藿香正气水…）才值得调模型。
 * 目的：不给普通 S1 问题增加一次模型调用（延迟/成本）；外部问题必然含物质词。
 */
export function isExternalIntentCandidate(question: string): boolean {
  const q = String(question ?? '').trim()
  return q.length > 0 && q.length <= 120 && SUBSTANCE_PATTERN.test(q)
}

/** 分类 prompt（纯函数，可测）：只问意图，不给答案；不确定选 S1。 */
export function buildExternalIntentPrompt(question: string): string {
  return `你是"安心用药"的咨询意图分类器。把用户问题归到以下类别之一：
- S1：说明书能回答的用药解释 / 一般用药咨询
- medication-list：查药箱里有哪些药
- adherence：依从性 / 漏服统计
- expiry-stock：效期 / 库存
- interaction-check：查本地规则库里的药物相互作用（两种药联用）
- next-dose：今日待服 / 下次服药时间
- ${EXTERNAL_INTENT_LABEL}：药与酒、西柚、咖啡、浓茶等非药品物质同服的问题（本地说明书库未收录）
只输出严格 JSON：{"intent":"类别"}。不确定时选 S1（宁可不判外部）。
用户问题：${question}`
}

/** 解析模型输出为二值判定；非法/缺失 → null（由调用方回落规则）。 */
export function parseIntentVerdict(raw: unknown): ExternalIntentVerdict | null {
  const parsed = ModelIntentSchema.safeParse(raw)
  if (!parsed.success) return null
  return parsed.data.intent === EXTERNAL_INTENT_LABEL ? 'external' : 'not-external'
}

/** 默认分类器：DeepSeek 非思考 + temperature 0；失败抛错由上层捕获回落。 */
async function classifyWithDeepseek(question: string): Promise<ExternalIntentVerdict> {
  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return 'not-external' // 未配置 = 不启用，而非失败
  const timeoutMs = Number(process.env.INTENT_MODEL_TIMEOUT_MS ?? 2500)
  const res = await callJson<ChatResponse>(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        temperature: 0,
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: buildExternalIntentPrompt(question) }],
      }),
    },
    { client: 'deepseek', timeoutMs, retries: 0 },
  )
  const raw = parseModelJson(extractChatContentStrict(res, 'deepseek'), 'deepseek')
  const verdict = parseIntentVerdict(raw)
  if (verdict === null) {
    throw new Error('意图分类输出不符合约定（非 7 类枚举）')
  }
  return verdict
}

/**
 * 模型判定「是否外部知识问题」：候选门控 → 分类器 → 二值。
 * 任何失败（未配置/超时/坏 JSON/异常）都返回 false —— 失败可见（stderr），但不阻塞回答。
 */
export async function shouldAnswerExternalByModel(question: string): Promise<boolean> {
  if (!isIntentModelEnabled()) return false
  if (!isExternalIntentCandidate(question)) return false
  try {
    const verdict = await (injectedClassifier ?? classifyWithDeepseek)(question)
    return verdict === 'external'
  } catch (e) {
    console.error(
      '[consult/intent-external] 模型意图判定失败，回落规则：',
      e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    )
    return false
  }
}
