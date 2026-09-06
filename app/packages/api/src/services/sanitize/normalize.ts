/**
 * 脱敏 L0/L1 共用的文本归一化纯函数（PRD §7.2.2 版面裁剪「锚点容错：大小写/空格/半全角」）。
 *
 * 零 I/O、确定性。归一只服务于「锚点/字段容错匹配」，绝不改写要落库或展示的原文——
 * 原文抄录由 L1 白名单在归一后的输入上按原样截取（见 whitelist.ts）。
 */

/** 全角 → 半角：FF01–FF5E 减 0xFEE0；全角空格 U+3000 → 半角空格。用于容忍 OCR 的全角数字/字母/冒号。 */
export function toHalfWidth(input: string): string {
  return String(input ?? '').replace(/[\uFF01-\uFF5E\u3000]/g, (ch) => {
    const code = ch.charCodeAt(0)
    return code === 0x3000 ? ' ' : String.fromCharCode(code - 0xFEE0)
  })
}

/**
 * 锚点归一：全角转半角 → 去所有空白 → 去常见标点 → 转小写。
 * 使 `Rp` / `Ｒｐ` / `rp：` / `R p` / `℞` 等形态收敛到同一可比形态（`rp` / `℞`）。
 */
export function normalizeAnchor(input: string): string {
  return toHalfWidth(input)
    .replace(/[\s\u3000]/g, '')
    .replace(/[::.,、,。·・\-_/\\|()（）[\]{}]/g, '')
    .toLowerCase()
}
