/**
 * 身份线（M2-T4 · PRD §7.2.3 / §8.2）——`src/services/identity/`。
 *
 *   matchDrugMaster(identity, candidates)  药名+规格+剂型三项严格匹配 → unique/ambiguous/conflict/no_match
 *   identifyDrug(image, clients, candidates)  VLM 提取身份 → 匹配（薄编排，DI 接缝）
 *   normalizeToken/parseStrengthTokens/strengthOverlap/nameMatches/formMatches  比对原语（照搬 demo）
 *
 * 层检测 detectLayers 与身份提取 extractIdentity 的模型调用 + zod safeParse 在 lib/ai（M2-T1），
 * 其 safeParse 失败分支单测见 __tests__/ai-clients.test.ts；本目录聚焦纯匹配逻辑与身份线编排。
 * 系统对多候选/冲突一律不自动裁决，交确认页冲突清单（PRD §8.2）。
 */
export * from './normalize.js'
export * from './match.js'
export * from './identify.js'
