/**
 * 脱敏 L3 · 出口约束（PRD §7.2.2 / §12.2 L3）。
 *
 * 管道纪律的最后一道门：
 *   - `redactForLog(obj)`：一切**日志出口**的脱敏包装——敏感键整值抹除，其余字符串跑更宽模式集；
 *     纯函数、不改入参。OCR 原文只在内存即用即弃，绝不经此落日志。
 *   - `assertNoPii(text)` / `findPii(text)`：正则断言，供**零泄漏测试**（M2-T9 CI 硬闸门）复用；
 *     命中即抛错，且**错误信息只含类型与次数，绝不回显 PII 原文**（否则错误日志本身即泄漏）。
 */
import { PII_ASSERT_PATTERNS, scrubWithPatterns, type PiiPattern } from './scan.js'

/** 敏感键名（无论值形态一律整值脱敏）——L3 日志出口的键级红线。 */
export const SENSITIVE_KEY_RE =
  /(patientname|fullname|\bname\b|phone|mobile|tel|idcard|idnumber|identity|address|病历号|门诊号|住院号|病案号|姓名|电话|手机|住址|地址|身份证)/i

/** PII 命中（不暴露原文：仅类型 + 位置）。 */
export interface PiiMatch {
  type: string
  index: number
}

/** 用给定模式集扫描文本，返回命中（类型+位置，无原文）。 */
function scanPatterns(text: string, patterns: PiiPattern[]): PiiMatch[] {
  const s = String(text ?? '')
  const out: PiiMatch[] = []
  for (const { type, re } of patterns) {
    const matcher = new RegExp(re.source, re.flags)
    for (const m of s.matchAll(matcher)) {
      out.push({ type, index: m.index ?? 0 })
    }
  }
  return out.sort((a, b) => a.index - b.index)
}

/** 找出文本中所有 PII 命中（手机号/身份证/地址/病历号/标签姓名）；只报类型+位置，绝不返回原文子串。 */
export function findPii(text: string): PiiMatch[] {
  return scanPatterns(text, PII_ASSERT_PATTERNS)
}

/** 零泄漏断言失败：错误信息仅含类型×次数，不含任何 PII 原文。 */
export class PiiDetectedError extends Error {
  constructor(public readonly matches: PiiMatch[]) {
    const counts: Record<string, number> = {}
    for (const m of matches) counts[m.type] = (counts[m.type] ?? 0) + 1
    const summary = Object.entries(counts)
      .map(([t, n]) => `${t}×${n}`)
      .join('，')
    super(`检测到未脱敏 PII（${summary}）`)
    this.name = 'PiiDetectedError'
  }
}

/**
 * 零泄漏断言：文本含任何 PII 模式即抛 `PiiDetectedError`，干净则静默返回。
 * 供 M2-T9 zero-leak.test.ts 对 DB 落库/日志/第三方请求体全路径复用。
 */
export function assertNoPii(text: string): void {
  const matches = findPii(text)
  if (matches.length > 0) throw new PiiDetectedError(matches)
}

function redact(v: unknown): unknown {
  if (typeof v === 'string') return scrubWithPatterns(v, PII_ASSERT_PATTERNS)
  if (Array.isArray(v)) return v.map(redact)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      // 敏感键：整值抹除（不看内容）；其余：递归 + 值级模式脱敏
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[已脱敏]' : redact(val)
    }
    return out
  }
  return v
}

/**
 * 日志出口脱敏（纯函数，深拷贝）：敏感键整值 `[已脱敏]`，其余字符串跑更宽模式集。
 * 用于一切 console/log/审计出口，确保日志永不携带身份信息。
 */
export function redactForLog<T>(obj: T): T {
  return redact(obj) as T
}
