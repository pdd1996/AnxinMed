/**
 * 确认页纯逻辑（M2-T7）—— 表单初始态 / 闸门校验 / 四类标注归算 / confirm 入参装配。
 *
 * 零 I/O、确定性，全部可单测（见 draft.test.ts）。放这里的三条红线：
 *   ① **绝不预填猜测**：needsManual / sigMissing 覆盖的字段初始值恒为空串（PRD §7.2.6）；
 *   ② **系统不选边**：冲突清单初始不选中任何候选（selectedCandidateId=''），未选定不得确认（PRD §8.2）；
 *   ③ **健康勾选 ⊆ 建议清单**：fieldKey 一律取自 payload.healthSuggestions（服务端会 400 拒绝清单外字段）。
 */
import { addDaysStr, estimateStockDays, todayStr, type CycleType, type DraftConfirm, type PlanTags } from '@anxin/shared'
import type { DraftPayloadDto } from '@/api/client'

/** 草稿载荷（api 侧 DraftPayload 经 hc<AppType> 推导，web 不复制类型）。 */
export type DraftPayload = DraftPayloadDto
export type PlanDraft = NonNullable<DraftPayload['planDraft']>
export type Candidate = NonNullable<NonNullable<DraftPayload['conflicts']>[number]['candidates']>[number]

/** 疗程三选一（PRD §7.3.2）：长期服用 / 用完为止 / 自定义天数。 */
export type CycleChoice = 'longterm' | 'until-used' | 'custom'

export interface ManualDrugForm {
  genericName: string
  specification: string
  form: string
  stockValue: string
  stockUnit: string
}

export interface ConfirmFormState {
  // ── 身份线 ──
  /** 冲突清单中用户选定的候选 id；初始 ''（系统不选边）。 */
  selectedCandidateId: string
  /** 用户在冲突清单里改走「手动建档」。 */
  useManual: boolean
  manual: ManualDrugForm
  // ── 医嘱线 ──
  doseValue: string
  doseUnit: string
  frequency: string
  route: string
  startDate: string
  cycle: CycleChoice
  /** 处方抄录了疗程时，用户主动改走三选一（改后 duration 标注降为「自填」）。 */
  cycleOverride: boolean
  customDays: string
  times: string[]
  meal: string
  /** 无差别逐项核对：抄录值必须逐项勾「已核对」才放行（PRD §7.2.5）。 */
  checked: { dose: boolean; frequency: boolean; duration: boolean }
  // ── 健康信息 / 使用人 ──
  /** fieldKey → 是否勾选写入（初始全 false：勾选才写入）。 */
  healthChecked: Record<string, boolean>
  /** fieldKey → 值（初始为建议值，用户改过则服务端落 self_reported）。 */
  healthValue: Record<string, string>
  /** 「这是给谁用的药」已确认（处方草稿恒需勾选，见 WhoCard）。 */
  whoConfirmed: boolean
}

const MEALS = ['无特殊要求', '饭前', '饭后', '随餐', '睡前']
export const CONFIRM_MEALS = MEALS

// ── 缺项判定（红线 ①：这些字段绝不预填）──

/** 整份草稿降级（OCR/裁剪/解析失败）→ 医嘱与身份全部人工补。 */
function allManual(p: DraftPayload): boolean {
  return p.degraded != null || (p.needsManual ?? []).includes('items')
}

/** 医嘱某项是否属人工补（sigMissing 由 parseSig 产出；needsManual 的 'usage' 表示原文整行缺用法）。 */
export function sigNeedsManual(p: DraftPayload, key: 'dose' | 'frequency'): boolean {
  if (!p.planDraft) return true
  if (allManual(p)) return true
  const needs = p.needsManual ?? []
  return needs.includes('usage') || (p.planDraft.sigMissing ?? []).includes(key)
}

/** 身份某项是否属人工补（入口B 降级时 needsManual 为 genericName/specification/form；入口A 条目字段为 drugName/…）。 */
export function identityNeedsManual(p: DraftPayload, field: 'genericName' | 'specification' | 'form'): boolean {
  if (allManual(p)) return true
  const needs = p.needsManual ?? []
  return needs.includes(field) || (field === 'genericName' && needs.includes('drugName'))
}

/** 医嘱项是否有「抄录值」（有则必须勾已核对；无则用户自填，标注 user）。 */
export function hasTranscribed(p: DraftPayload, key: 'dose' | 'frequency' | 'duration'): boolean {
  const plan = p.planDraft
  if (!plan || allManual(p)) return false
  if (key === 'duration') return Boolean(plan.durationDays)
  return !sigNeedsManual(p, key) && plan[key] != null
}

// ── 冲突清单（红线 ②）──

/** 带候选的冲突（用户须从中选定或改手动建档）；去重按候选 id。 */
export function selectableCandidates(p: DraftPayload): Candidate[] {
  const seen = new Map<string, Candidate>()
  for (const c of p.conflicts ?? []) {
    for (const cand of c.candidates ?? []) if (!seen.has(cand.id)) seen.set(cand.id, cand)
  }
  return [...seen.values()]
}

/** 信息型冲突（层间冲突等，无候选可选，仅列出待核对）。 */
export function infoConflicts(p: DraftPayload) {
  return (p.conflicts ?? []).filter((c) => !(c.candidates ?? []).length)
}

/** 身份线无唯一匹配（含降级 identity=null）→ 走手动建档。 */
export function isNoMatch(p: DraftPayload): boolean {
  return !p.match || p.match.status === 'no_match'
}

/** 当前是否处于手动建档模式（用户改走 / 身份线无匹配）。 */
export function isManualMode(p: DraftPayload, s: ConfirmFormState): boolean {
  return s.useManual || (isNoMatch(p) && !s.selectedCandidateId)
}

export function selectedCandidate(p: DraftPayload, s: ConfirmFormState): Candidate | null {
  if (!s.selectedCandidateId) return null
  return selectableCandidates(p).find((c) => c.id === s.selectedCandidateId) ?? null
}

/** 人工补用量时的默认单位（按剂型归一，属「默认」标注，用户可改）；无线索回落「片」。 */
export function defaultDoseUnit(p: DraftPayload): string {
  const text = `${p.drugDraft.form ?? ''}${p.identity?.form ?? ''}${p.drugDraft.genericName ?? ''}`
  if (/滴眼|滴鼻|滴耳/.test(text)) return '滴'
  if (/喷雾|气雾/.test(text)) return '喷'
  if (/颗粒|袋/.test(text)) return '袋'
  if (/胶囊/.test(text)) return '粒'
  if (/丸/.test(text)) return '丸'
  if (/支|注射|口服液/.test(text)) return '支'
  return '片'
}

// ── 初始态 ──

/**
 * 草稿 → 表单初始态。
 * 关键点：抄录值照抄供核对；needsManual/sigMissing 覆盖项**留空**；冲突候选**不预选**；健康建议**不预勾**。
 */
export function initialConfirmState(p: DraftPayload): ConfirmFormState {
  const plan = p.planDraft ?? null
  const unit = plan?.dose?.unit ?? defaultDoseUnit(p)
  const manual: ManualDrugForm = {
    genericName: identityNeedsManual(p, 'genericName') ? '' : (p.drugDraft.genericName ?? ''),
    specification: identityNeedsManual(p, 'specification') ? '' : (p.drugDraft.specification ?? ''),
    form: identityNeedsManual(p, 'form') ? '' : (p.drugDraft.form ?? ''),
    stockValue: '1',
    stockUnit: unit,
  }
  return {
    selectedCandidateId: '',
    useManual: false,
    manual,
    doseValue: plan?.dose && !sigNeedsManual(p, 'dose') ? String(plan.dose.value) : '',
    doseUnit: unit,
    frequency: plan?.frequency != null && !sigNeedsManual(p, 'frequency') ? String(plan.frequency) : '',
    route: plan?.route ?? '',
    startDate: plan?.startDate || todayStr(),
    cycle: 'longterm',
    cycleOverride: false,
    customDays: '7',
    times: plan?.times ? [...plan.times] : [],
    meal: MEALS[0],
    checked: { dose: false, frequency: false, duration: false },
    healthChecked: {},
    healthValue: Object.fromEntries((p.healthSuggestions ?? []).map((s) => [s.field, s.value])),
    whoConfirmed: false,
  }
}

// ── 疗程归算 ──

/** 疗程三选一 → cycleType + endDate（closed 的结束日期由开始日期推算，标「推算」）。 */
export function resolveCycle(p: DraftPayload, s: ConfirmFormState): { cycleType: CycleType; endDate: string | null } {
  const plan = p.planDraft
  if (plan?.durationDays && !s.cycleOverride) {
    return { cycleType: 'closed', endDate: plan.endDate || addDaysStr(s.startDate, plan.durationDays) }
  }
  if (s.cycle === 'longterm') return { cycleType: 'open', endDate: null }
  if (s.cycle === 'until-used') return { cycleType: 'stock', endDate: null }
  return { cycleType: 'closed', endDate: addDaysStr(s.startDate, Number(s.customDays) || 0) }
}

/** 「用完为止」的预计可用天数（推算标注）；库存未知（非手动建档）→ 0，UI 提示确认后可在药箱补录。 */
export function stockDays(p: DraftPayload, s: ConfirmFormState): number {
  const stock = isManualMode(p, s) ? Number(s.manual.stockValue) || 0 : 0
  return estimateStockDays(stock, Number(s.doseValue) || 0, Number(s.frequency) || 0)
}

// ── 四类标注归算（PRD §7.2.4：用户修正的医嘱字段标 user）──

/** 最终 tags：以草稿 tags 为基线，用户改过 / 人工补录的项降为「自填」。 */
export function finalTags(p: DraftPayload, s: ConfirmFormState): PlanTags {
  const plan = p.planDraft
  const base: PlanTags = { ...(plan?.tags ?? {}) }
  const tags: PlanTags = { ...base }

  if (hasTranscribed(p, 'dose')) {
    const same = Number(s.doseValue) === plan?.dose?.value && s.doseUnit === plan?.dose?.unit
    tags.dose = same ? (base.dose ?? 'transcribed') : 'user'
  } else {
    tags.dose = 'user'
  }

  if (hasTranscribed(p, 'frequency')) {
    tags.frequency = Number(s.frequency) === plan?.frequency ? (base.frequency ?? 'transcribed') : 'user'
  } else {
    tags.frequency = 'user'
  }

  tags.duration = hasTranscribed(p, 'duration') && !s.cycleOverride ? (base.duration ?? 'transcribed') : 'user'

  const sameTimes = JSON.stringify(s.times) === JSON.stringify(plan?.times ?? [])
  tags.times = sameTimes ? (base.times ?? 'assist') : 'user'

  tags.startDate = plan && s.startDate === plan.startDate ? (base.startDate ?? 'default') : 'user'

  const { cycleType } = resolveCycle(p, s)
  if (cycleType === 'closed') tags.endDate = 'derived'
  else delete tags.endDate

  return tags
}

// ── 闸门（未满足项 → 用户可理解的中文原因，逐条显示）──

/** 尚未满足的确认条件（空数组 = 可确认）。文案直接展示，禁止静默禁用按钮。 */
export function unmetReasons(p: DraftPayload, s: ConfirmFormState): string[] {
  const reasons: string[] = []
  const plan = p.planDraft ?? null
  const manualMode = isManualMode(p, s)

  if (selectableCandidates(p).length > 0 && !manualMode && !s.selectedCandidateId) {
    reasons.push('冲突清单未选定：请核对药品实物后选择一致的条目，或改用手动建档')
  }
  if (manualMode) {
    if (!s.manual.genericName.trim() || !s.manual.specification.trim() || !s.manual.form.trim()) {
      reasons.push('手动建档需补全药名 / 规格 / 剂型（系统不预填猜测）')
    }
  }

  if (plan) {
    if (!(Number(s.doseValue) > 0)) reasons.push('请填写每次用量（对照处方原文，系统不预填）')
    if (!(Number(s.frequency) > 0)) reasons.push('请填写频次（每日几次）')
    if (s.times.length === 0) reasons.push('请至少设置一个服药时间点')
    if (!s.startDate) reasons.push('请填写开始日期')
    if (hasTranscribed(p, 'dose') && !s.checked.dose) reasons.push('请勾选「已核对」每次用量与处方原文一致')
    if (hasTranscribed(p, 'frequency') && !s.checked.frequency) reasons.push('请勾选「已核对」频次与处方原文一致')
    if (hasTranscribed(p, 'duration') && !s.cycleOverride && !s.checked.duration) {
      reasons.push('请勾选「已核对」疗程与处方原文一致')
    }
    // 疗程：抄录值未被改写时沿用封闭式；改走三选一（cycleOverride 或处方本无疗程）时自定义天数必填
    if ((!plan.durationDays || s.cycleOverride) && s.cycle === 'custom' && !(Number(s.customDays) > 0)) {
      reasons.push('请填写自定义疗程天数')
    }
  }

  // 处方草稿恒需确认使用人（前记身份信息已被脱敏丢弃，系统无法替你核对，见 WhoCard）
  if (p.type === 'prescription' && !s.whoConfirmed) reasons.push('请确认这盒药的使用人')

  return reasons
}

// ── confirm 入参装配 ──

/**
 * 表单态 → POST /api/drafts/:id/confirm 入参。
 * 追溯上下文（来源/白名单快照/裁剪引用/脱敏审计/确认留痕）由服务端从 payload 取，客户端不提交、也无法伪造。
 * health 的 fieldKey 一律取自 payload.healthSuggestions（红线 ③：只提交建议清单内字段）。
 */
export function buildConfirm(p: DraftPayload, s: ConfirmFormState): DraftConfirm {
  const plan = p.planDraft ?? null
  const chosen = selectedCandidate(p, s)
  const manualMode = isManualMode(p, s)

  const drug: DraftConfirm['drug'] = manualMode
    ? {
        genericName: s.manual.genericName.trim(),
        brandName: null,
        specification: s.manual.specification.trim(),
        form: s.manual.form.trim(),
        manufacturer: null,
        drugMasterId: null,
        confirmStatus: 'manual',
        stock: { value: Number(s.manual.stockValue) || 0, unit: s.manual.stockUnit },
      }
    : {
        genericName: chosen?.genericName ?? p.drugDraft.genericName ?? '',
        brandName: chosen?.brandName ?? p.drugDraft.brandName ?? null,
        specification: chosen?.specification ?? p.drugDraft.specification ?? null,
        form: chosen?.form ?? p.drugDraft.form ?? null,
        manufacturer: chosen?.manufacturer ?? p.drugDraft.manufacturer ?? null,
        drugMasterId: chosen?.id ?? p.drugDraft.drugMasterId ?? null,
        // 初判由管线给出（transcribed/ocr_matched）；缺失时按有无计划兜底
        confirmStatus: p.drugDraft.confirmStatus ?? (plan ? 'transcribed' : 'ocr_matched'),
        stock: null,
      }

  const health = (p.healthSuggestions ?? [])
    .filter((sug) => s.healthChecked[sug.field])
    .map((sug) => ({ fieldKey: sug.field, value: (s.healthValue[sug.field] ?? sug.value).trim() }))
    .filter((h) => h.value.length > 0)

  if (!plan) return { drug, health }

  const { cycleType, endDate } = resolveCycle(p, s)
  return {
    drug,
    plan: {
      dose: { value: Number(s.doseValue), unit: s.doseUnit },
      frequency: Number(s.frequency),
      times: s.times,
      route: s.route.trim() || null,
      meal: s.meal,
      cycleType,
      startDate: s.startDate,
      endDate,
      tags: finalTags(p, s),
    },
    health,
  }
}
