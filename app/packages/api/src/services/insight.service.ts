/**
 * 医生端洞察业务编排（M3-T3 · PRD §7.7）——`insight.service.ts`。
 *
 * 职责（M1-T7 三层分层）：
 *   1. listPatients()：患者列表 + 概要（调 insight.repo.listPatientsWithStats）；
 *   2. generateSummary(patientId)：
 *      - 查患者信息（listPatientsWithStats 里找）；
 *      - 组装 5 个只读工具（adherence / medicationList / interactions / expiry / riskEvents）；
 *      - 调 services/insight/run.ts 的 runInsightSummary（或 runInsightSummaryOffline 如无 BAICHUAN_API_KEY）；
 *      - 返回 InsightSummaryResponse（shared 契约）。
 *
 * ⚠️ 分层纪律：
 * - 本层不直接写 SQL（走 repositories）；
 * - 不做守门判断（走 services/insight/guards.ts 纯函数）；
 * - AI 客户端经 lib/ai/registry.ts 注入接缝取得（测试可 setAiClients(mock)）。
 */
import { isPlanActiveOn, todayStr, addDaysStr, type InsightSummaryResponse } from '@anxin/shared'
import * as assetsRepo from '../repositories/assets.repo.js'
import * as consultRepo from '../repositories/consult.repo.js'
import * as drugsRepo from '../repositories/drugs.repo.js'
import * as insightRepo from '../repositories/insight.repo.js'
import * as plansRepo from '../repositories/plans.repo.js'
import { getAiClients } from '../lib/ai/registry.js'
import { checkInteractions, type InteractionRuleInput } from './rules/index.js'
import { runInsightSummary, runInsightSummaryOffline, toRiskEventItem, toLastQuestion } from './insight/index.js'
import type { InsightTools, InteractionsSummary, RiskEventsSummary } from './insight/types.js'
import { ApiError } from '../lib/http.js'
import { ERR_CODES } from '@anxin/shared'

/** 患者列表（GET /api/insight/patients）。 */
export async function listPatients() {
  return insightRepo.listPatientsWithStats()
}

/** 生效计划集合的相互作用摘要（复用 M2-T5 checkInteractions）。 */
async function resolveInteractionsSummary(userId: string): Promise<InteractionsSummary> {
  const today = todayStr()
  const [planRows, drugRows, ruleRows] = await Promise.all([
    plansRepo.listPlans(userId),
    drugsRepo.listDrugs(userId),
    assetsRepo.listInteractionRules(),
  ])

  // 生效计划集合（active 且时间窗覆盖今日）→ 药的 drugMasterId（手动建档 masterId=null 排除）
  const activeMasterIds = drugRows
    .filter((d) => d.drugMasterId && planRows.some((p) => p.drugId === d.id && isPlanActiveOn(p, today)))
    .map((d) => d.drugMasterId as string)

  const rules: InteractionRuleInput[] = ruleRows.map((r) => ({
    id: r.id,
    drugIds: (r.drugIds as string[] | null) ?? [],
    level: r.level,
    note: r.note,
    source: r.source,
  }))
  const names = await assetsRepo.findDrugMasterNames(activeMasterIds)
  const result = checkInteractions(activeMasterIds, rules, names)

  return {
    hasInteraction: result.hits.length > 0,
    items: result.hits.map((h) => ({
      level: h.level,
      note: h.note,
      drugs: h.drugNames,
    })),
  }
}

/** 风险事件流摘要（risk_events + consult_logs 聚合）。 */
async function resolveRiskEventsSummary(userId: string): Promise<RiskEventsSummary> {
  const [eventRows, consultRows, blockedCount] = await Promise.all([
    consultRepo.listRiskEvents(userId, 20),
    consultRepo.listConsultLogs(userId, 50),
    consultRepo.countBlockedConsults(userId),
  ])

  return {
    events: eventRows.map(toRiskEventItem),
    consultCount: consultRows.length,
    lastQuestion: toLastQuestion(consultRows),
    blockedCount,
    hasL4: eventRows.some((e) => e.level === 'L4'),
    hasL3: eventRows.some((e) => e.level === 'L3'),
  }
}

/**
 * 生成诊前摘要（POST /api/insight/summary）。
 * @param patientId 患者 id（users.id）
 */
export async function generateSummary(patientId: string): Promise<InsightSummaryResponse> {
  // 1. 查患者信息
  const patients = await insightRepo.listPatientsWithStats()
  const patient = patients.find((p) => p.id === patientId)
  if (!patient) {
    throw new ApiError(404, ERR_CODES.NOT_FOUND, '未找到该患者，请确认 patientId')
  }

  // 2. 组装 5 个只读工具（并行取数）
  const [adherence, medicationList, interactions, expiry, riskEvents] = await Promise.all([
    insightRepo.getAdherenceStats(patientId, 30),
    insightRepo.getMedicationList(patientId),
    resolveInteractionsSummary(patientId),
    insightRepo.getExpiryStatus(patientId),
    resolveRiskEventsSummary(patientId),
  ])

  const tools: InsightTools = { adherence, medicationList, interactions, expiry, riskEvents }
  const dateRange = `${addDaysStr(todayStr(), -29)} ~ ${todayStr()}`

  // 3. 调编排层（有 BAICHUAN_API_KEY 走 LLM，否则离线降级）
  const hasKey = Boolean(process.env.BAICHUAN_API_KEY)
  if (!hasKey) {
    return runInsightSummaryOffline({ patient, tools, dateRange })
  }

  const ai = getAiClients()
  return runInsightSummary({ patient, tools, dateRange, ai })
}
