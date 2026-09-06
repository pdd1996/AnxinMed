/**
 * 处方笺国标锚点（PRD §7.2.2 / §12.2 L0）：前记=患者信息区，正文=Rp 药品明细，后记=签名。
 * cropBody（几何裁剪）与 parseWhitelist（文本条目边界）共用同一套锚点判定，避免两处漂移。
 *
 * 锚点容错经 normalizeAnchor 收敛大小写/空格/半全角后再判定。
 */
import { normalizeAnchor } from './normalize.js'

/**
 * 起始锚点：`Rp` / `℞`（国标处方正文起始标志）。
 * 归一后须恰为 `rp` 或 `℞`——严格等值避免误命中含 "rp" 字母的词（如商品名拼音）。
 */
export function isStartAnchor(text: string): boolean {
  const norm = normalizeAnchor(text)
  return norm === 'rp' || norm === '℞'
}

/**
 * 结束锚点：处方完毕 / 签名 / 审核 / 调配 等后记标志（照搬 demo 已验证集合并扩充）。
 * 医师/医生/药师 **必须带冒号**（demo 同源：`医[师生]\s*[：:]`），避免正文里
 * “必要时咨询医师”之类用法行被裸词误判为后记而提前截断正文。
 */
export const END_ANCHOR_RE = /处方完毕|签名|审核|调配|医[师生]\s*[：:]|药师\s*[：:]/

export function isEndAnchor(text: string): boolean {
  return END_ANCHOR_RE.test(String(text ?? ''))
}

/** 诊断锚点（前记内）：临床诊断 / 诊断。用于报告与「前记被正确裁掉」的隐私自验。 */
export const DIAGNOSIS_ANCHOR_RE = /临床诊断|诊断/

export function isDiagnosisAnchor(text: string): boolean {
  return DIAGNOSIS_ANCHOR_RE.test(String(text ?? ''))
}
