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
  hasMultiStrengthSpec,
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
  /** 该条目登记的全部批准文号（主批号 + 分包装/多规格）；>1 即不能据此唯一确认身份。 */
  approvalNumbers?: string[] | null
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
  /** ambiguous 的补充说明（如"库条目为多规格合并，无法唯一确认"）；透传到确认页冲突清单 note。 */
  note?: string
}

/**
 * 库条目是否「多规格合并 / 多批准文号」——这类条目**禁止判 unique**（2026-11-19 身份展示止血）。
 *
 * 起因（现场截图）：一条 PDF 抽取的库记录把 80mg/240mg 合并成一行、只保留"主批号"H20138001，
 * 结果 240mg 的盒子被展示成 80mg 的批准文号。根因是"一行 = 一个规格"的前提被违反。
 * 因此：多批准文号（分包装/多规格）或多强度规格文本的条目，只能作为候选让用户按实物选择。
 */
export function isMultiSpecEntry(
  candidate: Pick<DrugMasterCandidate, 'specification' | 'approvalNumbers'>,
): boolean {
  return (candidate.approvalNumbers?.length ?? 0) > 1 || hasMultiStrengthSpec(candidate.specification)
}

/** 多规格合并条目的候选说明（确认页冲突清单 note，用户可见）。 */
export const MULTI_SPEC_MATCH_NOTE =
  '库中命中的条目是「多规格合并 / 多批准文号」记录（规格写成类似「80mg，240mg」），无法按规格唯一确认。' +
  '请对照实物包装选择，或在下方填写包装上的批准文号辅助定位（选填·不做官方校验），也可改用手动建档。'

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

  // ③b 多规格合并/多批准文号条目不得唯一确认（P1 匹配止血）：先剔除，干净候选才可 unique。
  const cleanMatches = specMatches.filter((d) => !isMultiSpecEntry(d))

  if (cleanMatches.length === 1) {
    return { status: 'unique', match: cleanMatches[0] }
  }

  if (cleanMatches.length > 1) {
    // 多候选 → 批准文号平局裁判（有则一锤定音，无/仍多条则不阻塞进冲突清单）
    if (identity.approvalNumber) {
      const wanted = approvalKey(identity.approvalNumber)
      const byApproval = cleanMatches.filter((d) => approvalKey(d.approvalNumber ?? '') === wanted)
      if (byApproval.length === 1) {
        return {
          status: 'unique',
          match: byApproval[0],
          resolutionNote: `多候选已按批准文号 ${identity.approvalNumber} 裁决为唯一匹配（实物/官方库 > 多源交叉）`,
        }
      }
    }
    return { status: 'ambiguous', candidates: cleanMatches }
  }

  // 命中的全部是「多规格合并/多批准文号」条目 → 不判唯一，交用户按实物规格选择
  if (specMatches.length > 0) {
    return { status: 'ambiguous', candidates: specMatches, note: MULTI_SPEC_MATCH_NOTE }
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
