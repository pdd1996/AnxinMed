/**
 * 规则引擎（M2-T5 · PRD §7.8 / §8.2 / §8.3）——`src/services/rules/`。
 *
 *   checkInteractions(drugMasterIds, rules, nameById)  生效计划集合的相互作用匹配（四级分级 + 未覆盖提示）
 *   checkDosageRange(planDraft, packageInsert)         说明书范围校验（频次/单次量超标只标注不阻止）
 *
 * 两引擎均为纯函数（零 I/O、确定性），DB 取数在 repositories/assets.repo.ts，编排在 plans.service。
 * 接入点：手动建计划（POST /api/plans）与 M2-T6 草稿确认两条路径都跑这两个检查（PRD §7.8.2 时机二）。
 */
export * from './interactions.js'
export * from './dosage.js'
