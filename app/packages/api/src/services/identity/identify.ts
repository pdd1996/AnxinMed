/**
 * 身份线编排（M2-T4）——`identifyDrug`：VLM 提取身份 → 三项严格匹配。
 *
 * 薄编排层：模型调用（extractIdentity，已在 lib/ai 内过 zod safeParse）+ 纯函数匹配（matchDrugMaster）。
 * 依赖注入 `Pick<AiClients,'extractIdentity'>`，测试注入 mock，不真调模型。
 * 模型输出非法时 extractIdentity 抛 AIUnavailableError，本层不吞、原样冒泡 → 上层降级（可见失败）。
 */
import type { AiClients, IdentityFields, ImageInput } from '../../lib/ai/types.js'
import { matchDrugMaster, type DrugMasterCandidate, type MatchResult } from './match.js'

export interface IdentifyOutcome {
  /** VLM 提取并已过 safeParse 的身份字段。 */
  identity: IdentityFields
  /** 对 drug_master 的三项严格匹配结果。 */
  result: MatchResult
}

/**
 * 身份线：提取 → 匹配。
 * @param image      上传图像
 * @param clients    AI 客户端接缝（仅需 extractIdentity）
 * @param candidates drug_master 候选集（由调用方经仓储取得；本函数不碰 DB）
 */
export async function identifyDrug(
  image: ImageInput,
  clients: Pick<AiClients, 'extractIdentity'>,
  candidates: DrugMasterCandidate[],
): Promise<IdentifyOutcome> {
  const identity = await clients.extractIdentity(image)
  const result = matchDrugMaster(identity, candidates)
  return { identity, result }
}
