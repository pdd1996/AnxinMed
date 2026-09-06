/**
 * 身份线三项严格匹配（M2-T4 · PRD §8.2）——`matchDrugMaster`。
 *
 * 药名 + 规格 + 剂型三项严格匹配才算唯一候选；任何冲突 / 多候选 / 规格不一致 →
 * 进确认页冲突清单，**不输出确定性结论、不自动裁决**（宁可失败不可编造）。
 * 批准文号 = 平局裁判：多候选时用于一锤定音；无则不阻塞（处方笺上没有该字段，不作为通过条件）。
 *
 * 纯函数：候选集由调用方（T6 管线经 drug_master 仓储）传入，本函数不碰 DB。
 * 药盒层永不涉及用法用量——IdentityFields 结构上就没有剂量字段（见 lib/ai/types.ts）。
 */
import type { IdentityFields } from '../../lib/ai/types.js'
import {
  approvalKey,
  formMatches,
  hasStrength,
  nameMatches,
  parseStrengthTokens,
  strengthOverlap,
} from './normalize.js'

/** drug_master 匹配所需的最小候选形态（结构兼容 Drizzle 行，多余字段忽略）。 */
export interface DrugMasterCandidate {
  id: string
  genericName: string
  brandName?: string | null
  specification: string
  form: string
  manufacturer?: string | null
  approvalNumber?: string | null
}

export type MatchStatus = 'unique' | 'ambiguous' | 'conflict' | 'no_match'

/** 冲突详情：哪一项冲突、提取值 vs 库值、用户可理解的说明。 */
export interface MatchConflict {
  field: 'specification' | 'form'
  extracted: string
  library: string
  note: string
}

export interface MatchResult {
  status: MatchStatus
  /** unique 时命中的库条目。 */
  match?: DrugMasterCandidate
  /** ambiguous / conflict 时的候选清单（系统不选边，交用户核对）。 */
  candidates?: DrugMasterCandidate[]
  /** conflict 时的冲突详情。 */
  conflict?: MatchConflict
  /** 批准文号平局裁决说明（unique 且经裁决时）。 */
  resolutionNote?: string
}

/** 去重拼接候选的某字段（用于冲突详情展示）。 */
function joinUnique(list: DrugMasterCandidate[], pick: (d: DrugMasterCandidate) => string): string {
  return [...new Set(list.map(pick).filter(Boolean))].join(' / ')
}

/**
 * 三项严格匹配。
 * @param identity   VLM 提取的药品身份字段（genericName 必填）
 * @param candidates drug_master 候选集（全库或按名预筛）
 */
export function matchDrugMaster(
  identity: IdentityFields,
  candidates: DrugMasterCandidate[],
): MatchResult {
  const list = candidates ?? []
  const name = identity?.genericName ?? ''

  // ① 药名：归一化双向子串。无任何药名命中 → 无匹配（不猜）。
  const namePool = list.filter((d) => nameMatches(name, d.genericName))
  if (namePool.length === 0) return { status: 'no_match' }

  // ② 剂型：identity 缺剂型则不阻塞；命中药名但剂型全不符 → 剂型冲突。
  const formPool = namePool.filter((d) => formMatches(identity.form, d.form))
  if (formPool.length === 0) {
    const libraryForm = joinUnique(namePool, (d) => d.form)
    return {
      status: 'conflict',
      candidates: namePool,
      conflict: {
        field: 'form',
        extracted: identity.form ?? '未知',
        library: libraryForm,
        note: `药名命中但剂型不一致（提取：${identity.form ?? '未知'}；库：${libraryForm}），请核对药品实物`,
      },
    }
  }

  // ③ 规格：解析成 {value,unit} 再比。
  const identityTokens = parseStrengthTokens(identity.specification ?? '')
  const specMatches = formPool.filter((d) =>
    strengthOverlap(parseStrengthTokens(d.specification), identityTokens),
  )

  if (specMatches.length === 1) {
    return { status: 'unique', match: specMatches[0] }
  }

  if (specMatches.length > 1) {
    // 多候选 → 批准文号平局裁判（有则一锤定音，无/仍多条则不阻塞进冲突清单）
    if (identity.approvalNumber) {
      const wanted = approvalKey(identity.approvalNumber)
      const byApproval = specMatches.filter((d) => approvalKey(d.approvalNumber ?? '') === wanted)
      if (byApproval.length === 1) {
        return {
          status: 'unique',
          match: byApproval[0],
          resolutionNote: `多候选已按批准文号 ${identity.approvalNumber} 裁决为唯一匹配（实物/官方库 > 多源交叉）`,
        }
      }
    }
    return { status: 'ambiguous', candidates: specMatches }
  }

  // specMatches 为空：药名+剂型命中但规格未确证
  if (!hasStrength(identityTokens)) {
    // identity 缺可比规格 → 无法确证唯一，列候选交用户核对（不猜、不自动选）
    return { status: 'ambiguous', candidates: formPool }
  }
  // 规格矛盾（如库 0.2% vs 提取 0.1%）→ 规格冲突
  const librarySpec = joinUnique(formPool, (d) => d.specification)
  return {
    status: 'conflict',
    candidates: formPool,
    conflict: {
      field: 'specification',
      extracted: identity.specification ?? '未知',
      library: librarySpec,
      note: `规格不一致（库 ${librarySpec} vs 提取 ${identity.specification ?? '未知'}），请核对药品实物后选择`,
    },
  }
}
