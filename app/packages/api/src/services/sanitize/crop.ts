/**
 * 脱敏 L0 · 版面裁剪（PRD §7.2.2 步骤2 / §12.2 L0）。
 *
 * 处方笺为国标格式：前记（患者信息区）= 姓名/性别/年龄/门诊号/电话/地址等身份信息，
 * 正文（Rp 药品明细），后记（医师/药师签名）。本层以字符坐标做**纯几何裁剪**：
 *   - 定位起始锚点 `Rp`/`℞`、结束锚点 `处方完毕`/签名等；
 *   - 返回正文区字符集合 + 外接裁剪框 box（存档图片只存此框）+ 正文文本；
 *   - 前记（含身份信息）与后记（签名）整块丢弃，绝不进入 chars/box/bodyText。
 *
 * 起始锚点缺失（涂黑遮挡/OCR 漏识）→ 返回 null，上层走原文人工补——**宁可失败不可编造**。
 * 以 demo/server/index.js 的「L0 文本等价」逻辑（rpIdx/endIdx 行界定）为参照，升级为字符级几何裁剪。
 */
import type { OcrChar, OcrResult } from '../../lib/ai/types.js'
import { isStartAnchor, isEndAnchor, isDiagnosisAnchor } from './anchors.js'

/** 裁剪框：左上角 + 宽高（与 OcrChar.box 同构）。 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

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
  /** 正文区字符集合（Rp 之后、处方完毕 之前）——前记后记字符已整块丢弃。 */
  chars: OcrChar[]
  /** 正文区外接裁剪框：存档图片只存此框（PRD §12.2 L0）。 */
  box: Box
  /** 正文区文本（按行以 \n 连接）——供 L1 条目解析与确认页原文对照。 */
  bodyText: string
  anchors: CropAnchors
}

/** 重建后的文本行：同一 y 带内的字符按 x 排序拼接。 */
interface Line {
  chars: OcrChar[]
  text: string
  yCenter: number
}

function yCenter(c: OcrChar): number {
  return c.box.y + c.box.h / 2
}

/**
 * 字符 → 行：按 y 中心聚类（阈值 = 字符高度中位数 × 0.6，最小 4px），行内按 x 排序拼接。
 * 确定性、零 I/O；OCR 字符级坐标是硬要求（见 lib/ai/ocr.ts）。
 */
export function buildLines(chars: OcrChar[]): Line[] {
  const list = chars ?? []
  if (list.length === 0) return []
  const sorted = [...list].sort((a, b) => yCenter(a) - yCenter(b) || a.box.x - b.box.x)

  const heights = sorted.map((c) => c.box.h).sort((a, b) => a - b)
  const medianH = heights[Math.floor(heights.length / 2)]
  const threshold = Math.max(4, medianH * 0.6)

  const lines: Line[] = []
  let group: OcrChar[] = []
  let ySum = 0
  const flush = () => {
    if (group.length === 0) return
    const lineChars = [...group].sort((a, b) => a.box.x - b.box.x)
    lines.push({
      chars: lineChars,
      text: lineChars.map((c) => c.text).join(''),
      yCenter: ySum / group.length,
    })
    group = []
    ySum = 0
  }
  for (const c of sorted) {
    const yc = yCenter(c)
    if (group.length > 0 && Math.abs(yc - ySum / group.length) <= threshold) {
      group.push(c)
      ySum += yc
    } else {
      flush()
      group = [c]
      ySum = yc
    }
  }
  flush()
  return lines
}

/** 正文区字符集合的外接矩形；空集合返回零框。 */
function unionBox(chars: OcrChar[]): Box {
  if (chars.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of chars) {
    minX = Math.min(minX, c.box.x)
    minY = Math.min(minY, c.box.y)
    maxX = Math.max(maxX, c.box.x + c.box.w)
    maxY = Math.max(maxY, c.box.y + c.box.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * L0 版面裁剪：从 OCR 字符级结果裁出正文区。
 * @returns 命中起始锚点 Rp/℞ → CropResult；起始锚点缺失 → null（走人工补）。
 */
export function cropBody(ocr: OcrResult): CropResult | null {
  const lines = buildLines(ocr?.chars ?? [])
  const startIdx = lines.findIndex((l) => isStartAnchor(l.text))
  if (startIdx < 0) return null // 起始锚点缺失（涂黑/漏识）→ 不猜，交回人工

  let endIdx = -1
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (isEndAnchor(lines[i].text)) {
      endIdx = i
      break
    }
  }
  // 正文 = 起始锚点行与结束锚点行之间（两端锚点行本身不含）；结束锚点缺失则延伸到最后一行。
  const bodyLines = lines.slice(startIdx + 1, endIdx > startIdx ? endIdx : lines.length)
  const chars = bodyLines.flatMap((l) => l.chars)

  return {
    chars,
    box: unionBox(chars),
    bodyText: bodyLines.map((l) => l.text).join('\n'),
    anchors: {
      startFound: true,
      endFound: endIdx > startIdx,
      diagnosisFound: lines.slice(0, startIdx).some((l) => isDiagnosisAnchor(l.text)),
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
  return buildLines(ocr?.chars ?? [])
    .map((l) => l.text)
    .join('\n')
}
