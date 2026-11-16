/**
 * 规则库正式化 · 守门纯函数（M8-T1）。
 *
 * 背景：PRD §7.8.1 规定相互作用规则**只能抄录**、来源限定为「两药说明书的相互作用段 /
 * 药监局修订公告 / 权威指南共识」，禁止模型推理生成。M8 前置核对发现：库内 3 条演示规则的
 * note 在对应说明书里均非逐字子串，且 2 条来源是「注意事项」段——所以「看起来有规则」不等于
 * 「有可追溯的规则」。本文件把「可追溯」变成可执行约束：
 *
 * - `status='demo'`：演示抄录，允许无 quote，但 source 必须自报「演示」，UI 必须标注；
 * - `status='curated'`：note 必须是 quote 的逐字子串、quote 必须是所引说明书段落的逐字子串，
 *   且所引说明书行必须是 reviewed；来源类型必须是 PRD 允许的三类；
 * - 药品 ID 必须存在、规则内不得重复、同药对不得重复。
 *
 * 纯函数：不碰数据库；数据库快照由调用方（seed 脚本 / 测试）传入。
 */
import { z } from 'zod'
import { InteractionLevelSchema } from '@anxin/shared'

export const RULE_STATUSES = ['demo', 'curated', 'retired'] as const
export type RuleStatus = (typeof RULE_STATUSES)[number]

export const RULE_SOURCE_TYPES = ['manual-interaction', 'nmpa-announcement', 'guideline'] as const
export type RuleSourceType = (typeof RULE_SOURCE_TYPES)[number]

/** PRD §7.8.1 允许的「说明书相互作用段」段名（含常见变体）。 */
export const INTERACTION_SECTION_KEYS = ['药物相互作用', '相互作用', '药物相互作用及配伍禁忌'] as const

/** curated 规则必须能解析出的来源引用（manual-interaction 用）。 */
export const RuleSourceRefSchema = z.object({
  insertId: z.string().min(1),
  drugId: z.string().min(1),
  sectionKey: z.string().min(1),
  version: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
})
export type RuleSourceRef = z.infer<typeof RuleSourceRefSchema>

export const RuleCurationInputSchema = z.object({
  id: z.string().min(1),
  drugIds: z.array(z.string().min(1)).min(2),
  level: InteractionLevelSchema,
  note: z.string().min(1),
  source: z.string().min(1),
  status: z.enum(RULE_STATUSES).default('demo'),
  sourceType: z.enum(RULE_SOURCE_TYPES).nullable().optional(),
  sourceRef: z.string().nullable().optional(),
  quote: z.string().nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.union([z.string(), z.date()]).nullable().optional(),
})
export type RuleCurationInput = z.infer<typeof RuleCurationInputSchema>

/** 说明书行快照（守门只读：来源行状态 + 原段文本）。 */
export interface ManualSnapshot {
  insertId: string
  drugId: string
  curationStatus: string
  sections: Record<string, string>
}

export interface RuleCurationContext {
  /** drug_master 中真实存在的 ID。 */
  existingDrugMasterIds: string[]
  /** 被 sourceRef 引用的说明书行，按 insertId 索引。 */
  manualsByInsertId: Record<string, ManualSnapshot>
  /** 库内已有规则（用于跨批重复药对检查；同批重复由 validateRules 自身兜底）。 */
  existingRules?: Array<{ id: string; drugIds: string[]; status: RuleStatus }>
  /** 显式允许同一药对有多条规则（默认不允许；确需时在任务书登记理由）。 */
  allowDuplicatePairs?: boolean
}

export interface RuleValidationResult {
  errors: string[]
  warnings: string[]
}

/** 逐字比较用的规范化：NFKC + 去空白（只消排版差异，不消标点/字词）。 */
export function normalizeQuoteText(input: string): string {
  return String(input ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
}

function pairKey(drugIds: string[]): string {
  return [...new Set(drugIds)].sort().join('|')
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 校验单条规则。返回 errors / warnings；errors 非空即不可入库。
 * curated 的「逐字」判定顺序：note ⊆ quote ⊆ 所引原文段（normalizeQuoteText 后比较）。
 */
export function validateRule(rule: RuleCurationInput, ctx: RuleCurationContext): RuleValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const label = `规则 ${rule.id}`

  // 1. 药品 ID：存在 + 去重
  const uniqueDrugIds = [...new Set(rule.drugIds)]
  if (uniqueDrugIds.length !== rule.drugIds.length) {
    errors.push(`${label}：drugIds 含重复药品`)
  }
  if (uniqueDrugIds.length < 2) {
    errors.push(`${label}：相互作用规则至少涉及 2 个药`)
  }
  const masters = new Set(ctx.existingDrugMasterIds)
  const missing = uniqueDrugIds.filter((id) => !masters.has(id))
  if (missing.length > 0) {
    errors.push(`${label}：drug_master 不存在这些 ID：${missing.join('、')}`)
  }

  // 2. 演示条目：必须自报「演示」，禁止冒充正式
  if (rule.status === 'demo') {
    if (!rule.source.includes('演示')) {
      errors.push(`${label}：status=demo 的 source 必须含「演示」字样（禁止把演示条目伪装成正式抄录）`)
    }
    return { errors, warnings }
  }

  // 3. 停用条目：不参与匹配，不做内容校验（保留历史）
  if (rule.status === 'retired') {
    warnings.push(`${label}：status=retired，不参与匹配；保留审计`)
    return { errors, warnings }
  }

  // 4. curated：来源类型 / 逐字引用 / 审核签名
  if (!rule.sourceType) {
    errors.push(`${label}：curated 必须填 source_type（${RULE_SOURCE_TYPES.join(' / ')}）`)
  }
  const quote = (rule.quote ?? '').trim()
  if (!quote) errors.push(`${label}：curated 必须填 quote（逐字抄录原文）`)
  if (!rule.reviewedBy?.trim()) errors.push(`${label}：curated 必须填 reviewed_by（实际核对人）`)
  if (!rule.sourceRef?.trim()) errors.push(`${label}：curated 必须填 source_ref（来源引用）`)

  if (rule.sourceType === 'manual-interaction') {
    let ref: RuleSourceRef | null = null
    try {
      ref = RuleSourceRefSchema.parse(JSON.parse(rule.sourceRef ?? ''))
    } catch {
      errors.push(`${label}：source_type=manual-interaction 的 source_ref 必须是合法 JSON：{insertId,drugId,sectionKey}`)
    }
    if (ref) {
      const manual = ctx.manualsByInsertId[ref.insertId]
      if (!manual) {
        errors.push(`${label}：source_ref.insertId 在库中不存在：${ref.insertId}`)
      } else {
        if (manual.drugId !== ref.drugId) {
          errors.push(`${label}：source_ref.drugId（${ref.drugId}）与说明书行实际 drugId（${manual.drugId}）不一致`)
        }
        if (!uniqueDrugIds.includes(ref.drugId)) {
          errors.push(`${label}：quote 来源药品 ${ref.drugId} 不在 drugIds 内`)
        }
        if (!(INTERACTION_SECTION_KEYS as readonly string[]).includes(ref.sectionKey)) {
          errors.push(
            `${label}：sectionKey「${ref.sectionKey}」不是 PRD §7.8.1 允许的相互作用段（允许：${INTERACTION_SECTION_KEYS.join('、')}）`,
          )
        }
        if (manual.curationStatus !== 'reviewed') {
          errors.push(`${label}：引用说明书行未 reviewed（${manual.curationStatus}），不能作为 curated 来源`)
        }
        const sectionText = manual.sections[ref.sectionKey] ?? ''
        if (!sectionText.trim()) {
          errors.push(`${label}：所引说明书段「${ref.sectionKey}」为空`)
        }
        if (quote && sectionText && !normalizeQuoteText(sectionText).includes(normalizeQuoteText(quote))) {
          errors.push(`${label}：quote 不是所引说明书段的逐字子串（禁止改写/摘要）`)
        }
      }
    }
  } else if (rule.sourceType === 'nmpa-announcement' || rule.sourceType === 'guideline') {
    const ref = rule.sourceRef?.trim() ?? ''
    if (ref && !isHttpUrl(ref)) {
      errors.push(`${label}：source_type=${rule.sourceType} 的 source_ref 需要是可访问的 URL`)
    }
    // 这类来源不在本地库，无法机器逐字校验；由 reviewed_by 人工负责，留 warning 供审计。
    if (quote) warnings.push(`${label}：外部来源无法机器逐字校验（${rule.sourceType}），以 reviewed_by 签名负责`)
  }

  // 5. note 必须是 quote 的逐字子串（PRD 只许抄录）
  if (quote && rule.note.trim() && !normalizeQuoteText(quote).includes(normalizeQuoteText(rule.note))) {
    errors.push(`${label}：note 不是 quote 的逐字子串（说明必须从原文截取，不得改写/总结）`)
  }

  return { errors, warnings }
}

/**
 * 批量校验：单条规则 + 批内/跨批同药对重复 + id 重复。
 * @param existingRules 库内已有规则；同批规则由 rules 自身参与重复检查
 */
export function validateRules(
  rules: RuleCurationInput[],
  ctx: RuleCurationContext,
): RuleValidationResult & { perRule: Record<string, RuleValidationResult> } {
  const errors: string[] = []
  const warnings: string[] = []
  const perRule: Record<string, RuleValidationResult> = {}

  const idSeen = new Set<string>()
  for (const rule of rules) {
    if (idSeen.has(rule.id)) errors.push(`规则 id 重复：${rule.id}`)
    idSeen.add(rule.id)
    const result = validateRule(rule, ctx)
    perRule[rule.id] = result
    errors.push(...result.errors)
    warnings.push(...result.warnings)
  }

  if (!ctx.allowDuplicatePairs) {
    const seen = new Map<string, string>()
    for (const rule of rules) {
      if (rule.status === 'retired') continue
      const key = pairKey(rule.drugIds)
      const prior = seen.get(key)
      if (prior) {
        errors.push(`同一药品组合出现多条规则：${rule.id} 与 ${prior}（药对 ${key}）`)
      } else {
        seen.set(key, rule.id)
      }
    }
    for (const rule of rules) {
      if (rule.status === 'retired') continue
      const key = pairKey(rule.drugIds)
      const clash = (ctx.existingRules ?? []).find(
        (r) => r.status !== 'retired' && !idSeen.has(r.id) && pairKey(r.drugIds) === key,
      )
      if (clash) {
        errors.push(`规则 ${rule.id} 与库内 ${clash.id} 是同一药品组合（药对 ${key}），重复入库需显式 allowDuplicatePairs`)
      }
    }
  }

  return { errors, warnings, perRule }
}

/** 摘要（seed --check / 关账报告共用）。 */
export function summarizeRules(rules: RuleCurationInput[]): Record<RuleStatus, number> {
  const out: Record<RuleStatus, number> = { demo: 0, curated: 0, retired: 0 }
  for (const r of rules) out[r.status] += 1
  return out
}
