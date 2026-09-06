/**
 * 咨询服务（M3-T1 · PRD §7.5）——`src/services/consult/`。
 *
 *   patterns.ts    三大正则（L4 emergency / L3 prohibited / L2 dosage）+ 段落路由
 *   sanitize.ts    sanitizeText / containsDosageAdvice / stripDosageAdvice
 *   guards.ts      detectEmergency / detectProhibited / detectManualGate / detectNoSource / guardConsult
 *   sections.ts    pickInsertSections / normalizeSections / fallbackSectionsFromInsert
 *   citations.ts   insertCitation（三件套）/ webSearchCitation（unverified）
 *   run.ts         runConsult 编排（守门分派 + LLM/降级 + 归一化 + citations）
 *   types.ts       InsertSlice / ConsultDrug / GuardDecision / ConsultRunInput / ConsultRunResult
 *
 * 全部纯函数（零 I/O、确定性）+ 编排层（run.ts）；DB 取数在 repositories/consult.repo.ts，
 * HTTP 层在 routes/consult.ts，业务编排在 services/consult.service.ts。
 *
 * LLM 请求体组装（buildConsultRequest / buildMedicalSearchRequest）在 lib/ai/baichuan.ts，
 * 与 M2-T1 buildFallbackParseRequest 同款纪律（纯函数可测，只含白名单文本）。
 *
 * 参照物：demo/server/index.js:940-1410（守门逻辑已实测）；迁移为 TS 并按 PRD §7.5 强化：
 * - citations 三件套（药名 + source + version）
 * - 医疗搜索默认关（env ENABLE_MEDICAL_SEARCH，本地未命中才兜底且标注"未经本库核实"）
 * - manual 档门禁（仅 L0 资料查询，拒绝个体化解释）
 * - AI 不可用 → AI_UNAVAILABLE 降级（fallbackSectionsFromInsert），不炸整体
 */
export * from './patterns.js'
export * from './sanitize.js'
export * from './guards.js'
export * from './sections.js'
export * from './citations.js'
export * from './run.js'
export * from './types.js'
