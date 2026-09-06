/**
 * 兜底解析编排（M2-T3 · PRD §7.2.2 步骤4 / 技术方案 §6 管线铁律）。
 *
 * 仅当 L1 正则解析有缺项时触发：把 **L0 裁剪后的正文（只含白名单文本）** + 缺项字段发给 Baichuan，
 * 模型返回值逐个过 verifyBacklink（回链校验），可寻的合并进白名单，不可寻的丢弃仍走人工补。
 *
 * 依赖注入：只依赖 `AiClients.fallbackParse`（T1 接缝），测试注入 mock，不直接 import 具体实现。
 * 降级：模型不可用（AIUnavailableError）→ 缺项原样保留人工补，不崩溃、不静默（可见状态）。
 */
import type { AiClients, FallbackFields } from '../../lib/ai/types.js'
import { AIUnavailableError } from '../../lib/ai/types.js'
import { PrescriptionWhitelist, type PrescriptionWhitelistType } from '@anxin/shared'
import type { ParseResult } from '../sanitize/whitelist.js'
import { computeNeedsManual } from '../sanitize/whitelist.js'
import { verifyBacklink } from './verify.js'

/** 兜底状态：无缺项/无可回链字段=not_needed；跑了=success；模型不可用=unavailable（降级）。 */
export type FallbackStatus = 'not_needed' | 'success' | 'unavailable'

export interface FallbackOutcome {
  /** 合并已验证兜底值后的白名单（仍过闭合 schema）。 */
  whitelist: PrescriptionWhitelistType
  /** 合并后剩余缺项（含被回链拦截的字段）。 */
  needsManual: string[]
  /** 回链拦截计数（模型返回但正文不可寻的字段数）。 */
  backlinkIntercepted: number
  /** 是否实际调用了兜底模型。 */
  fallbackTriggered: boolean
  fallbackStatus: FallbackStatus
}

/** 顶层标量字段（可被单值兜底回填）。 */
const TOP_FIELDS = ['hospital', 'prescriptionNo', 'date', 'department', 'diagnosis'] as const
/** 条目子字段路径：items[i].<field>。 */
const ITEM_FIELD_RE = /^items\[(\d+)\]\.(drugName|specification|quantity|usage)$/

/** 缺项是否可被「单值兜底 + 回链」恢复（裸 `items` 数组缺失无法由标量重建 → 不可）。 */
function isRecoverablePath(path: string): boolean {
  return (TOP_FIELDS as readonly string[]).includes(path) || ITEM_FIELD_RE.test(path)
}

/** 把已验证值按字段路径写回白名单（就地修改传入的深拷贝）；路径不适用返回 false。 */
function applyField(w: PrescriptionWhitelistType, path: string, value: string): boolean {
  switch (path) {
    case 'hospital':
      w.hospital = value
      return true
    case 'prescriptionNo':
      w.prescriptionNo = value
      return true
    case 'date':
      w.date = value
      return true
    case 'department':
      w.department = value
      return true
    case 'diagnosis':
      w.diagnosis = value
      return true
  }
  const m = ITEM_FIELD_RE.exec(path)
  if (m) {
    const item = w.items[Number(m[1])]
    if (item) {
      item[m[2] as 'drugName' | 'specification' | 'quantity' | 'usage'] = value
      return true
    }
  }
  return false
}

/**
 * 兜底解析编排。
 * @param parseResult L1 parseWhitelist 结果（缺项来源）
 * @param bodyText    L0 裁剪后正文（发给模型的白名单文本 + 回链基准；**不得**传含前记 PII 的全文）
 * @param clients     AI 客户端接缝（仅需 fallbackParse）
 */
export async function resolveFallback(
  parseResult: ParseResult,
  bodyText: string,
  clients: Pick<AiClients, 'fallbackParse'>,
): Promise<FallbackOutcome> {
  // ① 无缺项 → 不触发兜底
  if (parseResult.complete) {
    return {
      whitelist: parseResult.whitelist,
      needsManual: [],
      backlinkIntercepted: 0,
      fallbackTriggered: false,
      fallbackStatus: 'not_needed',
    }
  }

  // ② 缺项里没有可回链的标量字段（如仅缺整个 items 数组）→ 无从兜底，原样走人工补
  const missingFields = parseResult.needsManual.filter(isRecoverablePath)
  if (missingFields.length === 0) {
    return {
      whitelist: parseResult.whitelist,
      needsManual: parseResult.needsManual,
      backlinkIntercepted: 0,
      fallbackTriggered: false,
      fallbackStatus: 'not_needed',
    }
  }

  // ③ 调用兜底模型（只发白名单文本 + 缺项字段；请求体组装由 T1 保证不含图像/PII）
  let fallbackFields: FallbackFields
  try {
    fallbackFields = await clients.fallbackParse(bodyText, missingFields)
  } catch (err) {
    // 模型不可用 → 降级：缺项保持人工补，状态可见（不静默吞错，不炸管线）
    if (err instanceof AIUnavailableError) {
      return {
        whitelist: parseResult.whitelist,
        needsManual: parseResult.needsManual,
        backlinkIntercepted: 0,
        fallbackTriggered: true,
        fallbackStatus: 'unavailable',
      }
    }
    throw err
  }

  // ④ 回链校验：只保留正文逐字可寻的值
  const { verified, interceptedCount } = verifyBacklink(fallbackFields, bodyText)

  // ⑤ 合并（深拷贝，不改入参）→ 重过闭合 schema → 重算缺项
  const merged = structuredClone(parseResult.whitelist)
  for (const [path, value] of Object.entries(verified)) {
    applyField(merged, path, value)
  }
  const parsed = PrescriptionWhitelist.safeParse(merged)
  if (!parsed.success) {
    throw new Error(`兜底合并后白名单越界（不应发生，闭合 schema 拒绝）：${parsed.error.message}`)
  }

  return {
    whitelist: parsed.data,
    needsManual: computeNeedsManual(parsed.data),
    backlinkIntercepted: interceptedCount,
    fallbackTriggered: true,
    fallbackStatus: 'success',
  }
}
