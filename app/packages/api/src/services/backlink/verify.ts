/**
 * 脱敏/回链 · verifyBacklink（M2-T3 · PRD §7.2.2 步骤4 / 执行总纲 §3.2.2）。
 *
 * 模型兜底解析（Baichuan）产出的每个值，必须在 **L0 裁剪后的正文**中「逐字可寻」才可用；
 * 找不到的字段一律丢弃并回到 needsManual（走人工补），并记回链拦截计数。
 *
 * 这是「宁可失败不可编造」在医嘱线的关键闸门：模型可能改写/幻觉药名或用量，
 * 回链校验用**字面包含**（非正则）比对，确保落库的每个兜底值都真真切切来自处方原文。
 */
import { toHalfWidth } from '../sanitize/normalize.js'

/**
 * 回链归一：去所有空白 + 全角转半角（PRD §7.2.2「先做去空白/全半角归一」）。
 * 只用于「可寻性」比对，不改变最终落库值。
 */
export function normalizeForBacklink(s: string): string {
  return toHalfWidth(String(s ?? '')).replace(/\s+/g, '')
}

export interface BacklinkResult {
  /** 逐字可寻的字段：key → 值（保留模型返回的原值，已确证出现在正文中）。 */
  verified: Record<string, string>
  /** 找不到的字段键（含空值）——丢弃 → needsManual。 */
  rejected: string[]
  /** 回链拦截计数（= rejected.length），供审计与管线埋点。 */
  interceptedCount: number
}

/**
 * 回链校验（纯函数）。
 * @param fields   模型兜底解析产出：字段路径 → 值（如 `items[0].usage` → `每次1片 每日1次`）
 * @param bodyText L0 裁剪后的正文文本（回链基准）
 *
 * 判定：值归一后须为正文归一后的**子串**（字面包含，用 `includes` 而非正则，
 * 因此值里的 `.*`、`(` 等元字符按字面处理，不会被误当通配）。空值无从校验 → 直接拒。
 */
export function verifyBacklink(fields: Record<string, string>, bodyText: string): BacklinkResult {
  const normBody = normalizeForBacklink(bodyText)
  const verified: Record<string, string> = {}
  const rejected: string[] = []

  for (const [key, rawValue] of Object.entries(fields ?? {})) {
    const value = String(rawValue ?? '')
    const normValue = normalizeForBacklink(value)
    if (normValue.length === 0 || !normBody.includes(normValue)) {
      rejected.push(key) // 改写/幻觉/空值 → 丢弃走人工补，绝不落库
    } else {
      verified[key] = value
    }
  }

  return { verified, rejected, interceptedCount: rejected.length }
}
