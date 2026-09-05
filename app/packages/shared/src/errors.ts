/**
 * 统一错误码（技术方案 §5：错误响应 { ok: false, code, message }）。
 * 前后端一份真相；api onError / 守门 / 管线降级均引用此处，禁止散落字符串字面量。
 */
export const ERR_CODES = {
  UNSUPPORTED_OBJECT: 'UNSUPPORTED_OBJECT', // 层检测不支持的对象（散装药片等）→ 422
  LAYER_MISMATCH: 'LAYER_MISMATCH',         // 层检测结果与所选入口不符 → 409，不静默改道
  OCR_FAILED: 'OCR_FAILED',                 // OCR 失败 → 降级原文人工补
  PARSE_FAILED: 'PARSE_FAILED',             // 白名单解析失败/不全 → needsManual
  BACKLINK_FAILED: 'BACKLINK_FAILED',       // 回链校验失败（模型兜底值原文不可寻）→ 丢弃走人工补
  NOT_FOUND: 'NOT_FOUND',                   // 资源不存在 → 404
  VALIDATION: 'VALIDATION',                 // 入参 zod 校验失败 → 400
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',         // 模型不可用（503/超时）→ 降级，不影响药箱/计划/提醒
  RISK_INTERCEPTED: 'RISK_INTERCEPTED',     // 风险守门拦截（L3 拒答 / L4 急救）
  CONFLICT: 'CONFLICT',                     // 冲突（防重复 409 / 身份多候选等）
} as const

export type ErrCode = (typeof ERR_CODES)[keyof typeof ERR_CODES]
