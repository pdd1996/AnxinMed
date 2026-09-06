/**
 * 脱敏四层纯函数（M2-T2 · PRD §12.2）——`src/services/sanitize/`。
 *
 *   L0 cropBody        版面裁剪（字符级几何）：正文区字符集 + 裁剪框 box，前记后记整块丢弃；锚点缺失 → null
 *   L1 parseWhitelist  白名单解析：闭合 schema（身份信息结构性封顶）+ needsManual（不猜）
 *   L2 sanitizeScan    黑名单兜底：手机号/身份证(含校验位)/地址模式 → [已脱敏] + 审计（不记原文，宁可误杀）
 *   L3 redactForLog / assertNoPii  出口约束：日志脱敏 + 零泄漏断言（供 T9 复用）
 *
 * 全部零 I/O、确定性、可 mock，编排层（T6 pipeline/run.ts）串行调用。
 * 以 demo/server/index.js 已验证逻辑为参照重写为 TS 纯函数。
 */
export * from './normalize.js'
export * from './anchors.js'
export * from './crop.js'
export * from './whitelist.js'
export * from './scan.js'
export * from './log.js'
