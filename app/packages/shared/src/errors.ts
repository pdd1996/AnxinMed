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
  AUTH_REQUIRED: 'AUTH_REQUIRED',           // 未登录 / 缺 Bearer token → 401（G7）
  AUTH_INVALID: 'AUTH_INVALID',             // 登录凭据错误 / token 失效 → 401（统一措辞，不泄漏账号是否存在）
  AUTH_LOCKED: 'AUTH_LOCKED',               // 登录失败次数过多 → 429（G7 限流）
  AUTH_CODE_INVALID: 'AUTH_CODE_INVALID',   // 短信验证码错误/过期 → 401（P1 手机号登录）
  AUTH_PASSWORD_INVALID: 'AUTH_PASSWORD_INVALID', // 设密/改密时当前密码不正确 → 400（不能与登录 401 混用，避免前端误清登录态）
  SMS_NOT_CONFIGURED: 'SMS_NOT_CONFIGURED', // 部署未配置短信认证（缺 DYPNS_*）→ 503，失败可见
  SMS_SEND_FAILED: 'SMS_SEND_FAILED',       // 短信服务商发送失败/不可用 → 503
  SMS_LIMITED: 'SMS_LIMITED',               // 发码频控（同号冷却/同 IP 小时配额）→ 429
  RATE_LIMITED: 'RATE_LIMITED',             // 请求过于频繁（LLM 路由/IP 限流）→ 429（G10）
  BIND_LOCKED: 'BIND_LOCKED',               // 绑定码核销尝试过多（患者/IP 双维度限流）→ 429（specs/25 §5 补强）
  FORBIDDEN: 'FORBIDDEN',                   // 已登录但角色不匹配（如患者访问医生端接口）→ 403（specs/25）
} as const

export type ErrCode = (typeof ERR_CODES)[keyof typeof ERR_CODES]
