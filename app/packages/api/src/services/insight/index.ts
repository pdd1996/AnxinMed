/**
 * 医生端洞察服务（M3-T3 · PRD §7.7）——`src/services/insight/`。
 *
 *   guards.ts    guardSummary（L4/L3/L2/L1 二次守门，检测 LLM 输出）
 *   fallback.ts  fallbackPatientSummary（Baichuan 不可用降级，规则拼装）
 *   run.ts       runInsightSummary 编排（LLM/降级 + guardSummary）+ runInsightSummaryOffline
 *   types.ts     InsightTools / GuardedSummary / InsightRunInput / InsightRunResult
 *
 * 全部纯函数（零 I/O、确定性）+ 编排层（run.ts）；DB 取数在 repositories/insight.repo.ts，
 * HTTP 层在 routes/insight.ts，业务编排在 services/insight.service.ts。
 *
 * 参照物：demo/server/index.js:1297-1410（insight 两接口）+ demo/doctor.tsx（前端）；
 * 数据源从 mock JSON 改读 PostgreSQL（spec §T3）。
 */
export * from './guards.js'
export * from './fallback.js'
export * from './run.js'
export * from './types.js'
