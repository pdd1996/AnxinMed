/**
 * 咨询业务编排（M3-T1 · PRD §7.5）——`consult.service.ts`。
 *
 * 职责（M1-T7 三层分层）：
 *   1. 按 userId + drugIds[] 组装 ConsultDrug[]（drugs 表 + package_inserts 命中）；
 *   2. 组装 activeMasterIds（生效计划集合，复用 plans.service 逻辑）；
 *   3. 组装 interactionRules + drugNameById（复用 assets.repo + M2-T5 checkInteractions）；
 *   4. 用户提问过 scrubWithPatterns（L3 出口脱敏）；
 *   5. 前置分流：守门优先（L4/L3）→ 意图路由（数据查询走 dataquery.runDataQuery 只读工具，
 *      0 次 LLM 调用）→ 未命中/开关关则调 services/consult/run.ts 的 runConsult 说明书管线；
 *   6. 落库：insertConsultLog + insertRiskEvent（如触发 L4/L3/manual-gate）；
 *   7. 返回 ConsultResponse（shared 契约）。
 *
 * ⚠️ 分层纪律：
 * - 本层不直接写 SQL（走 repositories）；
 * - 不做守门判断（走 services/consult/guards.ts 纯函数）；
 * - AI 客户端经 lib/ai/registry.ts 注入接缝取得（测试可 setAiClients(mock)）。
 */
import {
  isPlanActiveOn,
  todayStr,
  type ConsultResponse,
  type RiskEventLevel,
  type RiskEventType,
  type RiskLevel,
} from '@anxin/shared'
import * as assetsRepo from '../repositories/assets.repo.js'
import * as consultRepo from '../repositories/consult.repo.js'
import * as drugsRepo from '../repositories/drugs.repo.js'
import * as plansRepo from '../repositories/plans.repo.js'
import { getAiClients } from '../lib/ai/registry.js'
import { PII_ASSERT_PATTERNS, scrubWithPatterns } from './sanitize/scan.js'
import { nameMatches } from './identity/normalize.js'
import { runConsult } from './consult/run.js'
import { runDataQuery } from './consult/dataquery.js'
import { classifyConsultIntent } from './consult/intent.js'
import { detectEmergency, detectProhibited } from './consult/guards.js'
import type { ConsultDrug, ConsultRunResult, InsertSlice } from './consult/types.js'
import type { InteractionRuleInput } from './rules/index.js'
import { newId } from '../lib/util.js'

/** env 开关：本地未命中该药品时才兜底开 Baichuan 医疗搜索（默认 false，PRD §7.5）。 */
function isMedicalSearchEnabled(): boolean {
  return String(process.env.ENABLE_MEDICAL_SEARCH ?? '').toLowerCase() === 'true'
}

/**
 * env 开关：意图路由灰度（默认开；仅显式 ENABLE_INTENT_ROUTE=false 才关）。
 * 关闭即回到旧行为（所有问题走 run.ts 说明书管线）——一行判断即整体回滚。
 */
function isIntentRouteEnabled(): boolean {
  return String(process.env.ENABLE_INTENT_ROUTE ?? '').toLowerCase() !== 'false'
}

/** package_inserts 行 → InsertSlice（裁剪到按键取数所需列）。 */
function toInsertSlice(row: assetsRepo.PackageInsertRow): InsertSlice {
  return {
    drugId: row.drugId,
    genericName: row.genericName,
    brandName: row.brandName,
    specification: row.specification,
    form: row.form,
    indication: row.indication,
    components: row.components,
    dosage: row.dosage,
    contraindications: row.contraindications,
    adverseReactions: row.adverseReactions,
    precautions: row.precautions,
    interactions: row.interactions,
    pharmacology: row.pharmacology,
    pharmacokinetics: row.pharmacokinetics,
    storage: row.storage,
    source: row.source,
    version: row.version,
  }
}

/**
 * 按 drugIds[] 组装 ConsultDrug[]（userId 过滤 + 说明书命中）。
 * - drugMasterId 非空 → findPackageInsertByDrugMasterId 直查；
 * - drugMasterId 为空（manual 档）→ listPackageInsertsByGenericNameLike + nameMatches 精筛兜底。
 */
async function resolveConsultDrugs(userId: string, drugIds: string[]): Promise<ConsultDrug[]> {
  if (drugIds.length === 0) return []
  const out: ConsultDrug[] = []
  for (const id of drugIds) {
    const drug = await drugsRepo.findDrug(userId, id)
    if (!drug) continue // 跨用户 id 或已删除：静默跳过（不泄漏资源存在性）
    let insertRow: assetsRepo.PackageInsertRow | undefined
    if (drug.drugMasterId) {
      insertRow = await assetsRepo.findPackageInsertByDrugMasterId(drug.drugMasterId)
    } else {
      // manual 档兜底：按通用名 ilike 初筛 + nameMatches 精筛（归一化双向子串）
      const candidates = await assetsRepo.listPackageInsertsByGenericNameLike(drug.genericName)
      insertRow = candidates.find((c) => nameMatches(drug.genericName, c.genericName))
    }
    out.push({
      id: drug.id,
      drugMasterId: drug.drugMasterId,
      genericName: drug.genericName,
      brandName: drug.brandName,
      confirmStatus: drug.confirmStatus,
      insert: insertRow ? toInsertSlice(insertRow) : null,
    })
  }
  return out
}

/** 生效计划集合的 drug_master.id（复用 plans.service runRuleChecks 的过滤逻辑）。 */
async function resolveActiveMasterIds(userId: string): Promise<string[]> {
  const today = todayStr()
  const [planRows, drugRows] = await Promise.all([plansRepo.listPlans(userId), drugsRepo.listDrugs(userId)])
  return drugRows
    .filter((d) => d.drugMasterId && planRows.some((p) => p.drugId === d.id && isPlanActiveOn(p, today)))
    .map((d) => d.drugMasterId as string)
}

/**
 * risk_events.level 映射（consult status → 事件级别）。
 * 仅 L4/L3/manual-gate 是风险事件；'data-answered'（及 answered/limited/no-source 等）走
 * default 分支返回 null → 不进 risk_events（数据查询是 L1 事实读取，非风险）。
 */
function toRiskEventLevel(status: string): RiskEventLevel | null {
  if (status === 'emergency') return 'L4'
  if (status === 'refused') return 'L3'
  if (status === 'manual-gate') return 'manual-gate'
  return null
}

/** risk_events.type 映射（细分口径，供医生端聚合）。 */
function toRiskEventType(status: string): RiskEventType | null {
  if (status === 'emergency') return 'emergency'
  if (status === 'refused') return 'refused'
  if (status === 'manual-gate') return 'manual-blocked'
  return null
}

/** blockedAt 映射（consult_logs 列；answered/limited 为 null）。 */
function toBlockedAt(status: string): RiskEventLevel | null {
  return toRiskEventLevel(status)
}

/**
 * POST /api/consult 业务入口。
 * @param userId    当前用户（resolveUser 中间件注入）
 * @param question  用户提问（原文；本层内做 L3 出口脱敏后落库与送 LLM）
 * @param drugIds   咨询对象（drugs.id[]；可空——L4/L3 可在无药上下文时触发）
 */
export async function consult(
  userId: string,
  question: string,
  drugIds: string[],
): Promise<ConsultResponse & { consultLogId: string }> {
  // 1. 用户提问脱敏（L3 出口约束）：落库与送 LLM 都用脱敏后文本，绝不带原文 PII
  const questionRedacted = scrubWithPatterns(question, PII_ASSERT_PATTERNS)

  // 2. 并行取数：咨询对象 + 生效计划集合 + 相互作用规则
  const [drugs, activeMasterIds, ruleRows] = await Promise.all([
    resolveConsultDrugs(userId, drugIds),
    resolveActiveMasterIds(userId),
    assetsRepo.listInteractionRules(),
  ])

  // 3. 组装规则引擎入参（复用 M2-T5 checkInteractions 的形态约定）
  const interactionRules: InteractionRuleInput[] = ruleRows.map((r) => ({
    id: r.id,
    drugIds: (r.drugIds as string[] | null) ?? [],
    level: r.level,
    note: r.note,
    source: r.source,
  }))
  const primaryMasterId = drugs.find((d) => d.drugMasterId)?.drugMasterId ?? null
  const nameIds = [...new Set([...activeMasterIds, ...(primaryMasterId ? [primaryMasterId] : [])])]
  const drugNameById = await assetsRepo.findDrugMasterNames(nameIds)

  // 4. AI 客户端（M2-T1 注入接缝；生产为 baichuan，测试可 setAiClients(mock)）
  const ai = getAiClients()

  // 5. 编排分流：守门优先 → 意图路由 → 说明书管线（run.ts）
  //
  // ⚠️ 守门顺序纪律：L4 emergency → L3 refused → 意图路由 → 说明书管线。
  //    混合句「我胸痛，还有多少药」必须走 L4，绝不被数据查询意图截胡；命中守门信号时
  //    **不做**意图判定，直接走原 runConsult —— 其内部 guardConsult 会再次判 emergency/refused，
  //    结果一致，且 risk_events 留痕逻辑保持单点（不在本层重复触发）。
  // ⚠️ 语义边界：manual-gate 只限「个体化解释」（LLM 生成路径）；数据查询是 L0 以下的事实读取
  //    （读本库 drugs/plans/records），不受 manual-gate 限制，故意图路由先于 manual-gate 判定。
  let result: ConsultRunResult | null = null

  // 5a/5b. 开关开 + 守门未命中 + 命中 QueryIntent → runDataQuery 只读工具（0 次 LLM 调用）。
  //        复用上面已取好的 activeMasterIds/interactionRules/drugNameById（请求内数据共享，不重复查库）。
  //        入参一律用脱敏后的 questionRedacted（L3 出口约束，绝不带原文 PII）。
  if (isIntentRouteEnabled() && !detectEmergency(questionRedacted) && !detectProhibited(questionRedacted)) {
    const intent = classifyConsultIntent(questionRedacted)
    if (intent) {
      result = await runDataQuery({ userId, intent, activeMasterIds, interactionRules, drugNameById })
    }
  }

  // 未命中意图 / 开关关 / 守门命中：原样走 run.ts 说明书管线（守门 + 生成 + 归一化 + citations）
  if (!result) {
    result = await runConsult({
      question: questionRedacted,
      drugs,
      activeMasterIds,
      interactionRules,
      drugNameById,
      enableMedicalSearch: isMedicalSearchEnabled(),
      ai,
    })
  }

  // 6. 落库：consult_logs（一次咨询一行）
  const consultLogId = newId('clog')
  await consultRepo.insertConsultLog({
    id: consultLogId,
    userId,
    question: questionRedacted,
    drugIds: drugIds.length > 0 ? drugIds : [],
    riskLevel: result.riskLevel as RiskLevel,
    status: result.status,
    blockedAt: toBlockedAt(result.status),
    notice: result.notice ?? result.l0Notice,
    citations: result.citations,
    sectionsSnapshot: result.sections,
  })

  // 7. 落库：risk_events（仅 L4/L3/manual-gate 触发；L1/L2 正常回答不算风险事件）
  const eventLevel = toRiskEventLevel(result.status)
  const eventType = toRiskEventType(result.status)
  if (eventLevel && eventType) {
    await consultRepo.insertRiskEvent({
      id: newId('revt'),
      userId,
      level: eventLevel,
      type: eventType,
      drugId: result.triggerDrugId,
      consultLogId,
      detail: {
        matchedKeyword: result.matchedKeyword,
        questionRedacted: questionRedacted.slice(0, 200), // 截断避免长文本占空间
      },
      occurredAt: new Date(),
    })
  }

  // 8. 返回前端（shared ConsultResponse 契约 + consultLogId 供前端"这次咨询"详情展开）
  return {
    riskLevel: result.riskLevel,
    status: result.status,
    answer: result.answer,
    sections: result.sections,
    citations: result.citations,
    notice: result.notice,
    l0Notice: result.l0Notice,
    blocked: result.blocked,
    toolUsed: result.toolUsed ?? null,
    consultLogId,
  }
}
