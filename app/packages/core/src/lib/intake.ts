/**
 * 录入页纯逻辑（M2-T8，M5-T2 迁入 core）—— 失败分支映射 / 质量判读 / 管线阶段文案 / 上传前置校验。
 *
 * 原则（PRD §7.2.6：全部「看得见地失败」）：任何失败都必须渲染成用户可理解的卡片 + 可行动的下一步
 * （重拍 / 换入口 / 人工补 / 手动建档），禁止静默吞错；质量预检只是**建议**，不拦用户（仍要上传可选）。
 *
 * 平台边界（M5-T2 接缝 #5）：像素统计（图片解码 + 逐像素采样）是平台能力，留在各端实现
 * （web=canvas，mobile 一期可降级不预检）；本模块只做「统计值 → 质量问题」的纯判读，
 * 由 ImageStatsProvider 类型把这条接缝固化下来。
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
 * 客户端合成码（服务端不会返回，由平台层在传输失败时造出来交给 mapIntakeFailure）：
 * 断网 / DNS 解析不到 / 请求超时。RN 真机上这是最常见的一类失败（手机与电脑不在同一 Wi-Fi、
 * 服务器地址填错、隧道断了），必须有独立文案——落到通用「无法可靠识别」会把用户引去重拍好照片。
 */
export const CLIENT_ERR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
} as const

/**
 * 传输失败 → 用户可见反馈（409 不静默改道 / 422 不支持 / 503 降级 / 传输失败 / 其余通用）。
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

  // 传输层失败：与「识别不出来」是两件事——照片不用重拍，网络要修
  if (input.status === 0 || input.code === CLIENT_ERR_CODES.NETWORK_ERROR || input.code === CLIENT_ERR_CODES.TIMEOUT) {
    return {
      kind: 'unavailable',
      title: '连不上服务器',
      body: input.message || '请求没有到达服务器（或等太久没回音），本次识别未完成。',
      hints: [
        '照片不需要重拍 —— 先处理网络，再点「重试」',
        '手机与电脑要在同一个 Wi-Fi（或改连公网地址），并确认服务器地址填写无误',
        '识别服务暂不可用，稍后重试即可',
      ],
      detected,
      allowManual: false,
      allowSwitch: false,
    }
  }

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

// ── 本地图片质量预检（纯判读部分；像素统计由各端实现 ImageStatsProvider）──

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

/**
 * 像素统计 provider 接缝（M5-T2）：平台层注入（web=canvas 实现）。
 * 返回 null = 本端不做/不能做预检（环境无 canvas、RN 一期降级）→ 调用方跳过建议、主流程照走
 * （预检只是建议，不拦用户）。
 */
export type ImageStatsProvider = (dataUrl: string) => Promise<ImageStats | null>

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
 * 可上传文件的形状（M5-T2 接缝：不引用 DOM File —— web 的 File、RN 的 expo-image-picker asset 天然满足）。
 */
export interface UploadableFile {
  name: string
  type: string
  size: number
}

/** 客户端上传前置校验（服务端 bodyLimit 22mb / dataURL 正则的同源口径，提前可见失败）。 */
export function validateFile(file: UploadableFile): string | null {
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return '请上传 JPG、PNG 或 WebP 图片'
  if (file.size > 15 * 1024 * 1024) return '图片超过 15MB，请压缩或重拍后再上传'
  return null
}
