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

/**
 * OCR 行级结果（ADR 新条目取代 #13：qwen3.5-ocr 行级转录，无字符级置信度/坐标）。
 * 诚实降级：不合成假坐标/假置信度，裁剪按行索引（sanitize/crop.ts）。
 */
export interface OcrResult {
  lines: string[]
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
 * 咨询回答原始分区（Baichuan 输出，经 ConsultRawSectionsSchema safeParse）。
 * 全字段可选：模型可能缺项，normalizeSections 内走 stripDosageAdvice + 兜底文案。
 */
export interface ConsultRawSections {
  summary?: string
  keyPoints?: string[]
  risks?: string[]
  nextAction?: string
  warning?: string
}

/** 咨询 prompt 入参（services/consult/prompt.ts 组装；只含白名单文本，不含图像/PII）。 */
export interface ConsultPromptPayload {
  question: string
  /** 药品身份快照（genericName/brandName/specification/form）+ manual 档标记。 */
  drug: {
    genericName: string
    brandName: string | null
    specification: string | null
    form: string | null
    isManual: boolean
  }
  /** 本次取用的说明书段落（label + version + text）。 */
  section: { label: string; version: string | null; text: string }
  /** 相互作用上下文渲染后的文本（已含「未覆盖 ≠ 无风险」提示）。 */
  interactionsText: string
}

/**
 * 医生端摘要 prompt 入参（M3-T3 · services/insight/run.ts 组装）。
 * 只含 5 个只读工具的聚合输出 + 患者基本信息（name/age/gender/conditions），不含 PII 原文。
 */
export interface InsightPromptPayload {
  patient: {
    name: string
    age: number | null
    gender: string | null
    conditions: string[]
  }
  dateRange: string
  /** 医生追问（T7 ask 长尾路径）：非空时 prompt 聚焦回答该问题，仍只基于工具输出事实。 */
  question?: string
  tools: {
    adherence: {
      rate: number
      taken: number
      total: number
      consecutiveSkip: number
      skipDetails: string[]
    }
    medicationCount: number
    medicationNames: string[]
    interactions: string[]
    expiry: {
      expiringCount: number
      expiredCount: number
      lowStockCount: number
    }
  riskEvents: {
    hasL4: boolean
    hasL3: boolean
    blockedCount: number
    lastQuestion: string
  }
}

}

/**
 * 队列摘要 prompt 入参（T7 · services/insight/queue.ts 组装）。
 * 字段最小化（ADR #17 第 5 条）：只发分档统计 + 差档名单（脱敏演示名，封顶）+ 事件计数，
 * 不带全量患者身份信息——队列场景泄露面大于单患者。
 */
export interface QueuePromptPayload {
  dateRange: string
  total: number
  grades: { good: number; fair: number; poor: number; ungraded: number }
  /** 执行率差的患者名单（封顶 10，供诊前点名随访；来自 listPatientsWithStats，演示数据已脱敏）。 */
  poorPatientNames: string[]
  riskEvents: { total: number; hasL4: boolean; hasL3: boolean }
  /** 医生追问（T7 ask 长尾路径）：非空时 prompt 聚焦回答该问题，仍只基于统计事实。 */
  question?: string
}

/**
 * 统一 AI 客户端接口。管线只依赖此接口，不直接 import 具体实现。
 * 每个方法失败时抛 AIUnavailableError（或经 zod safeParse 失败抛明确错误），由编排层转降级。
 */
export interface AiClients {
  /** 层检测：返回检测到的层标签数组（多选）。 */
  detectLayers(image: ImageInput): Promise<LayerLabel[]>
  /** 身份线：VLM 提取身份字段。 */
  extractIdentity(image: ImageInput): Promise<IdentityFields>
  /** 医嘱线 OCR：行级转录（qwen3.5-ocr，无字符级置信度/坐标）。 */
  runOcr(image: ImageInput): Promise<OcrResult>
  /** 兜底解析：仅当正则解析有缺项时触发；入参只含白名单文本。 */
  fallbackParse(bodyText: string, missingFields: string[]): Promise<FallbackFields>
  /**
   * 咨询回答（M3-T1）：本地说明书 + 相互作用上下文 → 结构化回答。
   * 输出必过 ConsultRawSectionsSchema safeParse；非法抛 AIUnavailableError。
   */
  consultAnswer(payload: ConsultPromptPayload): Promise<ConsultRawSections>
  /**
   * 医疗搜索兜底（M3-T1 · PRD §7.5，默认关）：仅当 ENABLE_MEDICAL_SEARCH=true 且本地未命中时触发。
   * 未实现时抛 AIUnavailableError（上层转 no-source 降级）。
   */
  medicalSearch?(question: string, drugName: string): Promise<ConsultRawSections>
  /**
   * 医生端摘要（M3-T3 · PRD §7.7）：5 个只读工具输出 + 患者信息 → 结构化摘要。
   * 输出 schema 与咨询相同（ConsultRawSectionsSchema）；非法抛 AIUnavailableError。
   */
  insightSummary(payload: InsightPromptPayload): Promise<ConsultRawSections>
  /**
   * 队列摘要（T7 · ADR #17 第 3 条）：分档统计 + 差档名单 + 事件计数 → 结构化叙述。
   * 数字全部来自工具计算结果，LLM 只做末端叙述；非法抛 AIUnavailableError。
   * 可选方法：FixtureAiClients / mock 未配置时由编排层转 error-fallback（不静默）。
   */
  queueSummary?(payload: QueuePromptPayload): Promise<ConsultRawSections>
}
