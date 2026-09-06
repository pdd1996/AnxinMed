/**
 * 脱敏 L2 · 黑名单兜底扫描（PRD §7.2.2 步骤5 / §12.2 L2）。
 *
 * 对 L1 白名单值跑敏感模式匹配（手机号 / 身份证含校验位 / 地址模式），命中替换 `[已脱敏]`，
 * 审计只记「类型 → 次数」（**绝不记原文**，PRD §12.2 L3）。设计原则：**宁可误杀**——
 * 失败方向统一为过度脱敏，而非漏放身份信息。
 *
 * 模式按特异性/长度降序排列：身份证（18 位）先于手机号（11 位），避免身份证号内嵌的
 * 11 位子串被误判为手机号而破坏脱敏（照搬 demo scrubValue 思路并修正顺序 + 补校验位验证）。
 */

/** 单条敏感模式：type 进审计，re 必须带 /g。 */
export interface PiiPattern {
  type: string
  re: RegExp
}

/** L2 值扫描模式（保守但宁可误杀；顺序即优先级）。 */
export const SENSITIVE_PATTERNS: PiiPattern[] = [
  { type: '身份证号', re: /\d{17}[\dXx]/g },
  { type: '手机号', re: /1[3-9]\d{9}/g },
  {
    type: '地址',
    re: /[\u4e00-\u9fa5]{2,8}(?:省|市)[\u4e00-\u9fa5]{2,10}(?:区|县|镇|街道)[\u4e00-\u9fa5]{2,12}(?:路|街|道|巷)\s*\d*号?/g,
  },
]

/**
 * L3 断言/日志用的更宽模式集：在 L2 基础上加「病历号/门诊号」与「标签锚定姓名」。
 * 姓名无法用无锚正则可靠识别，故**必须**由「姓名/患者姓名/名字」标签 + 分隔符锚定——
 * 裸 `患者`（如「患者教育不足」「患者依从性差」）是正常临床文案，绝不能当姓名误杀（否则
 * assertNoPii 会对干净数据假阳性、redactForLog 会涂改正常日志）；身份信息的结构性拦截仍由 L1 闭合 schema 兜底。
 */
export const PII_ASSERT_PATTERNS: PiiPattern[] = [
  ...SENSITIVE_PATTERNS,
  { type: '病历号', re: /(?:病历号|门诊号|住院号|病案号)[：:\s]*[A-Za-z0-9-]{3,}/g },
  { type: '姓名', re: /(?:患者姓名|姓名|名字)[：:\s]+[\u4e00-\u9fa5]{2,4}/g },
]

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

/**
 * 身份证校验位验证（GB 11643 / ISO 7064 MOD 11-2）。
 * 供高精度场景与单测复用；L2 扫描本身对 18 位形态一律脱敏（宁可误杀），校验位用于确证真伪。
 */
export function isValidIdChecksum(id: string): boolean {
  const s = String(id ?? '').trim().toUpperCase()
  if (!/^\d{17}[\dX]$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(s[i]) * ID_WEIGHTS[i]
  return ID_CHECK_CODES[sum % 11] === s[17]
}

/** 用指定模式集扫描单值：命中替换 `[已脱敏]`，audit 累加类型→次数（不记原文）。 */
export function scrubWithPatterns(
  value: string,
  patterns: PiiPattern[],
  audit: Record<string, number> = {},
): string {
  let out = String(value ?? '')
  for (const { type, re } of patterns) {
    // 每次新建 RegExp，避免共享 /g 字面量的 lastIndex 状态
    const matcher = new RegExp(re.source, re.flags)
    const hits = out.match(matcher)
    if (hits && hits.length > 0) {
      audit[type] = (audit[type] ?? 0) + hits.length
      out = out.replace(new RegExp(re.source, re.flags), '[已脱敏]')
    }
  }
  return out
}

/** L2 值扫描（默认 SENSITIVE_PATTERNS）。 */
export function scrubValue(value: string, audit: Record<string, number> = {}): string {
  return scrubWithPatterns(value, SENSITIVE_PATTERNS, audit)
}

export interface SanitizeResult<T> {
  /** 脱敏后的同构值（字符串叶子已扫描，结构保持不变）。 */
  value: T
  /** 审计：类型 → 命中次数（不含任何原文）。 */
  audit: Record<string, number>
}

function walk(v: unknown, audit: Record<string, number>): unknown {
  if (typeof v === 'string') return scrubValue(v, audit)
  if (Array.isArray(v)) return v.map((x) => walk(x, audit))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val, audit)
    return out
  }
  return v // number/boolean/null/undefined 原样保留
}

/**
 * L2 兜底扫描（纯函数，深遍历）：对白名单字段（或任意对象/数组/字符串）跑敏感模式，
 * 命中替换 `[已脱敏]` 并返回审计。**不修改入参**（返回深拷贝）。
 */
export function sanitizeScan<T>(fields: T): SanitizeResult<T> {
  const audit: Record<string, number> = {}
  return { value: walk(fields, audit) as T, audit }
}
