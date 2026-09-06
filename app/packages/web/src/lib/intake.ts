/**
 * 录入页纯逻辑（M2-T8）—— 失败分支映射 / 本地图片质量预检 / 管线阶段文案。
 *
 * 原则（PRD §7.2.6：全部「看得见地失败」）：任何失败都必须渲染成用户可理解的卡片 + 可行动的下一步
 * （重拍 / 换入口 / 人工补 / 手动建档），禁止静默吞错；质量预检只是**建议**，不拦用户（仍要上传可选）。
 * 质量预检在浏览器本地做（不下传、不依赖模型）：过暗 / 反光 / 模糊 / 分辨率过低四类具体重拍建议。
 */
import { ERR_CODES } from '@anxin/shared'

/** 录入入口：A=拍处方笺，B=拍药品。 */
export type Entry = 'A' | 'B'

/** 管线阶段文案（上传中状态，PRD §10.1「处理中状态明确」）。 */
export const STAGE_TEXT: Record<Entry, string[]> = {
  A: [
    '层检测 · 判定照片含有的信息层',
    '医嘱线 · OCR 转录（仅内存，即用即弃）',
    '医嘱线 · 版面裁剪 + 闭合白名单解析 + 兜底脱敏',
    '身份线 · 身份提取 + 药名/规格/剂型严格匹配',
    '汇合 · 草稿 + 相互作用 + 说明书范围校验',
  ],
  B: [
    '层检测 · 判定照片含有的信息层',
    '身份线 · 身份提取（药盒层不提取用法用量）',
    '身份线 · 药名/规格/剂型严格匹配',
    '汇合 · 建档草稿 + 相互作用检查',
  ],
}

/** 统一安全提示（不支持 / 识别失败共用，PRD §7.2.6）。 */
export const SAFETY_NOTE =
  '请勿根据本次结果服药或调整药物。所有失败分支都看得见：可重拍、可人工补、可手动建档兜底。'

// ── 失败分支映射 ──

export type FeedbackKind = 'unsupported' | 'mismatch' | 'unavailable' | 'generic'

export interface IntakeFeedback {
  kind: FeedbackKind
  title: string
  body: string
  /** 具体重拍/处理建议（质量问题、降级等）。 */
  hints: string[]
  /** 层检测标签（409/422 时展示，供用户判断）。 */
  detected: string[]
  /** 是否提供「手动建档」兜底动作。 */
  allowManual: boolean
  /** 是否提供「换入口」动作。 */
  allowSwitch: boolean
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * 传输失败 → 用户可见反馈（409 不静默改道 / 422 不支持 / 503 降级 / 其余通用）。
 * 入参只取 settle() 的结构化字段，纯函数可单测。
 */
export function mapIntakeFailure(input: {
  status: number
  code: string
  message: string
  details?: Record<string, unknown>
}): IntakeFeedback {
  const details = input.details ?? {}
  const detected = asStringList(details.detected)
  const suggestion = typeof details.suggestion === 'string' ? details.suggestion : ''

  if (input.code === ERR_CODES.UNSUPPORTED_OBJECT || detected.includes('不支持')) {
    return {
      kind: 'unsupported',
      title: '该对象暂不支持',
      body: input.message || '散装药片等对象无法可靠识别，本次不进入提取管线。',
      hints: ['散装药片没有可核对的包装信息，请改拍药盒或处方笺', '手里只有散装药片时，请用「手动建档」录入'],
      detected,
      allowManual: true,
      allowSwitch: true,
    }
  }

  if (input.code === ERR_CODES.LAYER_MISMATCH || input.status === 409) {
    return {
      kind: 'mismatch',
      title: '检测结果与所选入口不符',
      body: suggestion || input.message,
      hints: ['层检测是校验而不是分流 —— 系统不会静默改道，由你决定', '确认照片拿对了（处方笺 / 药盒）后再继续'],
      detected,
      allowManual: false,
      allowSwitch: true,
    }
  }

  if (input.code === ERR_CODES.AI_UNAVAILABLE || input.status === 503) {
    return {
      kind: 'unavailable',
      title: '识别服务暂不可用',
      body: input.message || '识别服务暂不可用，请稍后重试。',
      hints: ['稍后重试即可，照片不需要重拍', '着急建档时走「手动建档」，识别恢复后再拍照补来源'],
      detected,
      allowManual: true,
      allowSwitch: false,
    }
  }

  return {
    kind: 'generic',
    title: '无法可靠识别',
    body: input.message || '本次识别失败，请重拍或改用手动建档。',
    hints: [...RETAKE_CHECKLIST],
    detected,
    allowManual: true,
    allowSwitch: true,
  }
}

/** 通用重拍清单（识别失败 / 降级草稿共用）。 */
export const RETAKE_CHECKLIST = [
  '处方笺平铺完整入镜，覆盖 Rp 至「处方完毕」',
  '关闭闪光灯、避开顶灯反射，避免反光',
  '到光线充足处拍摄，避免过暗',
  '扶稳对焦、移开手指或物件遮挡',
]

// ── 本地图片质量预检（纯函数部分；像素统计由 computeImageStats 产出）──

export interface ImageStats {
  /** 0–255 平均亮度。 */
  meanLuma: number
  /** 高光截断像素占比（>245 视为截断，反光/过曝代理指标）。 */
  clippedRatio: number
  /** 灰度梯度均值 / 255（清晰度代理指标）。 */
  sharpness: number
  width: number
  height: number
}

export type QualityIssue = 'too-dark' | 'glare' | 'blurry' | 'too-small'

export const QUALITY_HINTS: Record<QualityIssue, string> = {
  'too-dark': '环境过暗：到光线充足处重拍，或开灯后避免手机影子落在纸面上',
  glare: '疑似反光：关闭闪光灯、避开顶灯/窗口反射，稍微倾斜纸面重拍',
  blurry: '疑似模糊或遮挡：扶稳手机、点按对焦后重拍，移开手指或物件遮挡',
  'too-small': '分辨率过低：靠近拍摄对象，让文字占满画面',
}

export const QUALITY_ISSUE_LABEL: Record<QualityIssue, string> = {
  'too-dark': '过暗',
  glare: '反光',
  blurry: '模糊/遮挡',
  'too-small': '分辨率过低',
}

/**
 * 像素统计 → 质量问题清单（阈值为本项目经验值，仅做重拍建议，不做任何医学/识别判断）。
 * 纯函数：测试用合成统计值即可覆盖，不依赖 canvas。
 */
export function assessQuality(s: ImageStats): QualityIssue[] {
  const issues: QualityIssue[] = []
  if (s.width < 480 || s.height < 480) issues.push('too-small')
  if (s.meanLuma < 60) issues.push('too-dark')
  if (s.clippedRatio > 0.18) issues.push('glare')
  if (s.sharpness < 0.02) issues.push('blurry')
  return issues
}

/**
 * dataURL → 像素统计（缩到 ≤512 边长再统计，成本可忽略）。
 * 环境不支持 canvas（如 jsdom 未装 canvas 包）→ 返回 null，调用方跳过预检（不报错、不阻塞）。
 */
export async function computeImageStats(dataUrl: string): Promise<ImageStats | null> {
  try {
    // 先探 canvas 能力（jsdom 无 canvas 包时 getContext 为 null）：不支持则跳过预检，
    // 避免再走图片解码（无资源加载器时 onload 永不触发，会挂死调用方）。
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const img = await loadImage(dataUrl)
    const scale = Math.min(1, 512 / Math.max(img.width, img.height))
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))
    canvas.width = width
    canvas.height = height
    ctx.drawImage(img, 0, 0, width, height)
    const { data } = ctx.getImageData(0, 0, width, height)

    const luma = new Float64Array(width * height)
    let sum = 0
    let clipped = 0
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const v = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      luma[p] = v
      sum += v
      if (v > 245) clipped++
    }
    const total = width * height
    let grad = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - 1; x++) {
        grad += Math.abs(luma[y * width + x + 1] - luma[y * width + x])
      }
    }
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width; x++) {
        grad += Math.abs(luma[(y + 1) * width + x] - luma[y * width + x])
      }
    }
    const edges = total - width + (total - height)
    return {
      meanLuma: sum / total,
      clippedRatio: clipped / total,
      sharpness: edges > 0 ? grad / edges / 255 : 0,
      width: img.width,
      height: img.height,
    }
  } catch {
    return null // 预检不可用 ≠ 图片有问题：跳过建议，主流程照走
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = dataUrl
  })
}

/** 客户端上传前置校验（服务端 bodyLimit 22mb / dataURL 正则的同源口径，提前可见失败）。 */
export function validateFile(file: File): string | null {
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return '请上传 JPG、PNG 或 WebP 图片'
  if (file.size > 15 * 1024 * 1024) return '图片超过 15MB，请压缩或重拍后再上传'
  return null
}
