/**
 * 回链校验与兜底解析（M2-T3 · PRD §7.2.2 步骤4）——`src/services/backlink/`。
 *
 *   verifyBacklink(fields, bodyText)  模型兜底值必须在 L0 正文中逐字可寻（去空白/全半角归一），否则丢弃
 *   resolveFallback(parse, body, ai)  仅当 L1 有缺项时触发兜底：发白名单文本 → 回链 → 合并；模型不可用则降级
 *
 * 纯函数 + 依赖注入接缝，编排层（T6 pipeline/run.ts）串在 ④parseWhitelist 与 ⑤sanitizeScan 之间。
 */
export * from './verify.js'
export * from './fallback.js'
