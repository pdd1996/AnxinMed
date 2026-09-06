/**
 * 草稿装配纯函数（M2-T6 · 管线 ⑦ buildDraft）—— 零 I/O、确定性、可 mock。
 *
 * 把身份线匹配结果 + 白名单条目 + 规则引擎结果装配成 DraftPayload 的各字段。
 * 铁律：计划草稿的 dose/frequency/duration 只来自 parseSig 对**处方原文 usage** 的解析（抄录不生成）；
 * 抽不出的一律留 null + sigMissing/needsManual（绝不预填猜测）。入口B 永不产出计划草稿（在 run.ts 结构保证）。
 */
import {
  addDaysStr,
  suggestTimes,
  todayStr,
  type DrugCandidate,
  type DraftConflict,
  type HealthSuggestion,
  type PlanDraft,
  type PlanTags,
  type PrescriptionItem,
  type PrescriptionWhitelistType,
} from '@anxin/shared'
import type { IdentityFields, OcrChar } from '../../lib/ai/types.js'
import type { Box } from '../sanitize/crop.js'
import { parseSig } from '../sanitize/whitelist.js'
import { nameMatches } from '../identity/normalize.js'
import type { DrugMasterCandidate, MatchResult } from '../identity/match.js'
import type { DrugDraft, LowConfidenceChar } from './types.js'

/**
 * 从药名推剂型（参照 demo formFromName，修正其 replace 缺陷）：仅用于身份线缺剂型时的归一提示，不猜药名。
 * demo 原式 m[1].replace('滴眼','滴眼液') 在匹配到「滴眼液」时会产出「滴眼液液」，改为仅对裸「滴眼」归一。
 */
export function formFromName(name: string): string {
  const m = String(name || '').match(/(滴眼液|滴眼|注射液|口服液|喷雾剂|软膏|乳膏|滴丸|颗粒|胶囊|栓|贴)/)
  if (m) return m[1] === '滴眼' ? '滴眼液' : m[1]
  if (/片$/.test(name || '')) return '片剂'
  return ''
}

/**
 * 计划草稿（照搬 demo buildPlanDraft 的四类标注规则；来源恒为处方，V2.1 无「标签抄录」）。
 * @param usageText 条目的用法用量原文（白名单 item.usage，抄录）
 * @param baseDate  起算日（处方日期，缺则今天）
 */
export function buildPlanDraft(usageText: string, baseDate: string): PlanDraft {
  const sig = parseSig(usageText)
  const dose = sig.dose ?? null
  const frequency = sig.frequency ?? null
  const durationDays = sig.durationDays ?? null
  const startDate = baseDate || todayStr()
  const times = frequency ? suggestTimes(frequency) : []
  const endDate = durationDays ? addDaysStr(startDate, durationDays) : null

  const tags: PlanTags = { times: 'assist', startDate: 'default' }
  if (dose) tags.dose = 'transcribed'
  if (frequency) tags.frequency = 'transcribed'
  if (durationDays) {
    tags.duration = 'transcribed'
    if (endDate) tags.endDate = 'derived'
  }

  return {
    dose,
    frequency,
    route: sig.route ?? null,
    durationDays,
    times,
    startDate,
    endDate,
    // 有疗程 → closed；否则待定（确认页三选一：长期/用完为止/自定义）
    cycleType: durationDays ? 'closed' : 'pending',
    sigMissing: (['dose', 'frequency'] as const).filter((k) => sig[k] == null),
    tags,
  }
}

/**
 * 条目 + 整图身份 → 该条目的有效身份。
 * 多条目处方「串味」防护：整图 VLM 身份通常只对应其中一个药，故商品名/规格/剂型/厂家/OTC/批准文号
 * 仅当 identity.genericName 与本条目药名可匹配（nameMatches 归一化双向子串）时才继承；
 * 否则只用条目自身的 OCR 名/规格 + 从药名推剂型（不猜）。
 */
export function buildItemIdentity(identity: IdentityFields | null, item: PrescriptionItem): IdentityFields {
  const same = Boolean(identity?.genericName && nameMatches(identity.genericName, item.drugName))
  return {
    genericName: item.drugName || identity?.genericName || '',
    brandName: same ? identity?.brandName : undefined,
    specification: item.specification || (same ? identity?.specification : undefined) || undefined,
    form: (same ? identity?.form : undefined) || formFromName(item.drugName) || undefined,
    manufacturer: same ? identity?.manufacturer : undefined,
    otcFlag: same ? identity?.otcFlag : undefined,
    approvalNumber: same ? identity?.approvalNumber : undefined,
  }
}

/** 身份线 + 匹配 → 档案草稿（confirmStatus 由 run.ts 按入口/是否有计划设定）。 */
export function buildDrugDraft(identity: IdentityFields | null, match: MatchResult | null): DrugDraft {
  const unique = match?.status === 'unique' ? match.match : undefined
  return {
    genericName: identity?.genericName || unique?.genericName || '',
    brandName: identity?.brandName ?? unique?.brandName ?? null,
    specification: identity?.specification ?? unique?.specification ?? null,
    form: identity?.form ?? unique?.form ?? null,
    manufacturer: identity?.manufacturer ?? unique?.manufacturer ?? null,
    drugMasterId: unique?.id ?? null,
  }
}

function toDrugCandidate(c: DrugMasterCandidate): DrugCandidate {
  return {
    id: c.id,
    genericName: c.genericName,
    brandName: c.brandName ?? null,
    specification: c.specification,
    form: c.form,
    manufacturer: c.manufacturer ?? null,
    approvalNumber: c.approvalNumber ?? null,
  }
}

/** 匹配结果 → 冲突清单（系统不选边，交确认页用户核对；unique/no_match 无冲突）。 */
export function toDraftConflicts(match: MatchResult | null): DraftConflict[] {
  if (!match) return []
  if (match.status === 'conflict' && match.conflict) {
    return [
      {
        type: match.conflict.field === 'form' ? 'form' : 'spec',
        field: match.conflict.field,
        note: match.conflict.note,
        extracted: match.conflict.extracted,
        library: match.conflict.library,
        candidates: (match.candidates ?? []).map(toDrugCandidate),
      },
    ]
  }
  if (match.status === 'ambiguous') {
    return [
      {
        type: 'multi',
        note: '识别到多个候选，系统不自动选择，请核对药品实物后从候选中选择，或改用手动建档',
        candidates: (match.candidates ?? []).map(toDrugCandidate),
      },
    ]
  }
  return []
}

/**
 * 健康信息「建议填入」（勾选才写入 health_profiles；PRD §7.1.2）。
 * 仅取闭合白名单内的诊断——性别/年龄等身份字段被 L0 裁剪 + L1 闭合 schema 结构性挡在外面（隐私红线），
 * 故不在此建议（如需扩展须先改白名单 schema 并过 ADR）。
 */
export function buildHealthSuggestions(w: PrescriptionWhitelistType | null): HealthSuggestion[] {
  if (!w?.diagnosis) return []
  return [{ field: '诊断', value: w.diagnosis, source: '处方笺抄录' }]
}

/** 裁剪正文内的低置信字符（去身份；确认页原文对照标红下划线）。 */
export function pickLowConfidenceChars(chars: OcrChar[], threshold = 0.9): LowConfidenceChar[] {
  return (chars ?? [])
    .filter((c) => c.confidence < threshold)
    .map((c) => ({ text: c.text, confidence: c.confidence, box: c.box as Box }))
}
