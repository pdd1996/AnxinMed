/**
 * 管线编排（M2-T6）—— `src/services/pipeline/`。
 *
 *   types.ts       PipelineContext（注入）/ DraftPayload（落库载荷）/ DrugDraft / Degraded
 *   layers.ts      入口校验：assertLayersForEntry（409 LAYER_MISMATCH / 422 UNSUPPORTED_OBJECT）+ layerSuggestion
 *   buildDraft.ts  ⑦ 装配纯函数：buildPlanDraft / buildDrugDraft / toDraftConflicts / buildHealthSuggestions / pickLowConfidenceChars
 *   run.ts         ①–⑦ 编排：detectOnly / runPrescription（N 拆 N）/ runDrug（入口B 无用法用量）
 *
 * 全部经 AiClients 依赖注入接缝（lib/ai/registry），不直接 import 具体模型实现；run.ts 不碰 DB。
 */
export * from './types.js'
export * from './layers.js'
export * from './buildDraft.js'
export * from './run.js'
