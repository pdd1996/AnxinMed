/**
 * 脱敏 L0 · 版面裁剪（PRD §7.2.2 步骤2 / §12.2 L0）。
 *
 * 处方笺为国标格式：前记（患者信息区）= 姓名/性别/年龄/门诊号/电话/地址等身份信息，
 * 正文（Rp 药品明细），后记（医师/药师签名）。qwen3.5-ocr 为行级转录（无字符坐标），
 * 本层按**行索引**裁剪（与 demo/server/index.js 的 rpIdx/endIdx 行界定逻辑同构）：
 *   - 定位起始锚点 `Rp`/`℞`、结束锚点 `处方完毕`/签名等；
 *   - 返回正文区行集合 + 正文文本；
 *   - 前记（含身份信息）与后记（签名）整块丢弃，绝不进入 lines/bodyText。
 *
 * 起始锚点缺失（涂黑遮挡/OCR 漏识）→ 返回 null，上层走原文人工补——**宁可失败不可编造**。
 */
import type { OcrResult } from '../../lib/ai/types.js'
import { isStartAnchor, isEndAnchor, isDiagnosisAnchor } from './anchors.js'

/** 锚点命中报告（供审计与「前记被正确裁掉」自验；不含任何原文内容）。 */
export interface CropAnchors {
  /** 起始锚点 Rp/℞ 是否命中（cropBody 返回非 null 时恒为 true）。 */
  startFound: boolean
  /** 结束锚点 处方完毕/签名 是否命中；缺失时正文延伸到最后一行。 */
  endFound: boolean
  /** 是否在**前记（Rp 之前）**识别到诊断锚点（临床诊断）——用于验证诊断未进入正文。 */
  diagnosisFound: boolean
  /** 起始锚点所在行号（0 基）；未命中为 -1。 */
  startLine: number
  /** 结束锚点所在行号（0 基）；未命中为 -1。 */
  endLine: number
}

export interface CropResult {
  /** 正文区行集合（Rp 之后、处方完毕 之前）——前记后记行已整块丢弃。 */
  lines: string[]
  /** 正文区文本（按行以 \n 连接）——供 L1 条目解析与确认页原文对照。 */
  bodyText: string
  anchors: CropAnchors
}

/**
 * L0 版面裁剪：从 OCR 行级转录裁出正文区。
 * @returns 命中起始锚点 Rp/℞ → CropResult；起始锚点缺失 → null（走人工补）。
 */
export function cropBody(ocr: OcrResult): CropResult | null {
  const lines = ocr?.lines ?? []
  const startIdx = lines.findIndex((l) => isStartAnchor(l))
  if (startIdx < 0) return null // 起始锚点缺失（涂黑/漏识）→ 不猜，交回人工

  let endIdx = -1
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (isEndAnchor(lines[i])) {
      endIdx = i
      break
    }
  }
  // 正文 = 起始锚点行与结束锚点行之间（两端锚点行本身不含）；结束锚点缺失则延伸到最后一行。
  const bodyLines = lines.slice(startIdx + 1, endIdx > startIdx ? endIdx : lines.length)

  return {
    lines: bodyLines,
    bodyText: bodyLines.join('\n'),
    anchors: {
      startFound: true,
      endFound: endIdx > startIdx,
      diagnosisFound: lines.slice(0, startIdx).some((l) => isDiagnosisAnchor(l)),
      startLine: startIdx,
      endLine: endIdx,
    },
  }
}

/**
 * OCR 全文重建（所有行，含前记后记）——L1 白名单解析的输入。
 * 前记中的身份字段由 L1 闭合 schema 结构性封顶（无字段可装），全文仅在内存即用即弃（L3）。
 */
export function ocrToText(ocr: OcrResult): string {
  return (ocr?.lines ?? []).join('\n')
}
