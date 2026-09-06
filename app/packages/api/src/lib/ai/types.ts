/**
 * AI 客户端层公共类型（M2-T1）。
 * 统一 `AiClients` 接口是管线 run.ts 的依赖注入接缝：生产组装真实实现（qwen/ocr/baichuan），
 * 测试/E2E 注入 mock 或 FixtureAiClients（fixture 回放），从而无 key 也能跑全真编排代码。
 */
import type { LayerLabel } from '@anxin/shared'

/** 模型不可用（超时/重试后仍失败/5xx）→ 上层走降级路径，绝不静默。 */
export class AIUnavailableError extends Error {
  constructor(
    public readonly client: 'qwen' | 'ocr' | 'baichuan',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'AIUnavailableError'
  }
}

/** 上传图像的统一输入（base64 + mime），避免各客户端各自解析 multipart。 */
export interface ImageInput {
  base64: string
  mime: string
}

/** OCR 字符级结果（PRD 硬要求：字符级置信度 + 坐标）。box 为左上角 + 宽高。 */
export interface OcrChar {
  text: string
  confidence: number
  box: { x: number; y: number; w: number; h: number }
}
export interface OcrResult {
  chars: OcrChar[]
}

/** 身份线 VLM 提取字段（药盒层永不含用法用量——结构上无此字段）。 */
export interface IdentityFields {
  genericName: string
  brandName?: string
  specification?: string
  form?: string
  manufacturer?: string
  otcFlag?: boolean
  approvalNumber?: string
}

/** 兜底解析（Baichuan）产出：字段键 → 值（须过回链校验才可用）。 */
export type FallbackFields = Record<string, string>

/**
 * 统一 AI 客户端接口。管线只依赖此接口，不直接 import 具体实现。
 * 每个方法失败时抛 AIUnavailableError（或经 zod safeParse 失败抛明确错误），由编排层转降级。
 */
export interface AiClients {
  /** 层检测：返回检测到的层标签数组（多选）。 */
  detectLayers(image: ImageInput): Promise<LayerLabel[]>
  /** 身份线：VLM 提取身份字段。 */
  extractIdentity(image: ImageInput): Promise<IdentityFields>
  /** 医嘱线 OCR：字符级置信度 + 坐标。 */
  runOcr(image: ImageInput): Promise<OcrResult>
  /** 兜底解析：仅当正则解析有缺项时触发；入参只含白名单文本。 */
  fallbackParse(bodyText: string, missingFields: string[]): Promise<FallbackFields>
}
