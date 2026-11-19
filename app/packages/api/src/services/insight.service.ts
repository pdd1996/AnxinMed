/**
 * 医生端洞察业务编排（M3-T3 · PRD §7.7）——`insight.service.ts`。
 *
 * 职责（M1-T7 三层分层）：
 *   1. listPatients()：患者列表 + 概要（调 insight.repo.listPatientsWithStats）；
 *   2. generateSummary(patientId)：
 *      - 查患者信息（listPatientsWithStats 里找）；
 *      - 组装 5 个只读工具（adherence / medicationList / interactions / expiry / riskEvents）；
 *      - 调 services/insight/run.ts 的 runInsightSummary（或 runInsightSummaryOffline 如文本链未配 key）；
 *      - 返回 InsightSummaryResponse（shared 契约）。
 *
 * ⚠️ 分层纪律：
 * - 本层不直接写 SQL（走 repositories）；
 * - 不做守门判断（走 services/insight/guards.ts 纯函数）；
 * - AI 客户端经 lib/ai/registry.ts 注入接缝取得（测试可 setAiClients(mock)）。
 */
import { isPlanActiveOn, todayStr, addDaysStr, type InsightQueueResponse, type InsightSummaryResponse } from '@anxin/shared'
import * as assetsRepo from '../repositories/assets.repo.js'
import * as consultRepo from '../repositories/consult.repo.js'
import * as drugsRepo from '../repositories/drugs.repo.js'
import * as insightRepo from '../repositories/insight.repo.js'
import * as plansRepo from '../repositories/plans.repo.js'
import { getAiClients } from '../lib/ai/registry.js'
import { isTextProviderConfigured } from '../lib/ai/index.js'
import { checkInteractions, type InteractionRuleInput } from './rules/index.js'
import { runInsightSummary, runInsightSummaryOffline, toRiskEventItem, toLastQuestion } from './insight/index.js'
import { countGrades, rollupTimeline, runQueueTool, type AdherenceDistributionResult, type PatientCohortResult, type RiskEventRollupResult } from './insight/tools.js'
import { runQueueSummary, runQueueSummaryOffline } from './insight/queue.js'
import { classifyQueueIntent, ASK_SUGGESTIONS } from './insight/askIntent.js'
import {
  renderAdherenceDistributionSections,
  renderPatientCohortSections,
  renderRiskEventRollupSections,
} from './insight/askTemplates.js'
import { classifyConsultIntent } from './consult/intent.js'
import { runDataQuery } from './consult/dataquery.js'
import { resolveDoctorPatientScope } from './binding.service.js'
import { scrubWithPatterns, PII_ASSERT_PATTERNS } from './sanitize/scan.js'
import { newId } from '../lib/util.js'
import type { QueuePromptPayload } from '../lib/ai/types.js'
import type { InsightTools, InteractionsSummary, RiskEventsSummary } from './insight/types.js'
import type { ConsultSections, InsightAdherenceSeriesResponse, InsightAskResponse, RiskLevel } from '@anxin/shared'
import { ApiError } from '../lib/http.js'
import { ERR_CODES } from '@anxin/shared'

/**
 * 患者可见性断言（specs/25 · ADR #23 第 1 条）：
 * - password 模式：只允许当前医生绑定关系内的患者，否则 404（不泄漏存在性）；
 * - demo 模式：旁路（scope=undefined），退化为既有「患者存在即可」语义，保证 E2E 逐字不变。
 */
async function assertPatientVisible(
  doctorId: string,
  patientId: string,
  precomputedScope?: string[],
): Promise<string[] | undefined> {
  const scope = precomputedScope ?? (await resolveDoctorPatientScope(doctorId))
  if (scope !== undefined) {
    if (!scope.includes(patientId)) {
      throw new ApiError(404, ERR_CODES.NOT_FOUND, '未找到该患者，请确认 patientId')
    }
    return scope
  }
  const patient = await insightRepo.findPatient(patientId)
  if (!patient) {
    throw new ApiError(404, ERR_CODES.NOT_FOUND, '未找到该患者，请确认 patientId')
  }
  return undefined
}

/** 患者列表（GET /api/insight/patients）——仅当前医生的授权患者（demo 模式旁路）。 */
export async function listPatients(doctorId: string) {
  const scope = await resolveDoctorPatientScope(doctorId)
  return insightRepo.listPatientsWithStats(30, scope)
}

/** 队列视图数据（GET /api/insight/queue · T7）：分档统计 + 患者表 + 事件时间线，0 次 LLM 直查库。 */
export async function getQueue(doctorId: string): Promise<InsightQueueResponse> {
  const days = 30
  const scope = await resolveDoctorPatientScope(doctorId)
  const patients = await insightRepo.listPatientsWithStats(days, scope)
  const rows = await insightRepo.listRiskEventsWindow(days, scope)

  return {
    generatedAt: new Date().toISOString(),
    dateRange: days,
    total: patients.length,
    grades: countGrades(patients),
    patients,
    riskTimeline: rollupTimeline(rows),
  }
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
    drugGroups: (r.drugGroups as string[][] | null) ?? null,
    level: r.level,
    status: r.status,
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
 * 生成诊前摘要（POST /api/insight/summary；T7 ask 患者维度长尾路径复用，带医生追问聚焦）。
 * @param patientId 患者 id（users.id）
 * @param question  医生追问（可空；非空时 LLM 聚焦回答该问题，仍只基于工具输出事实）
 */
export async function generateSummary(
  doctorId: string,
  patientId: string,
  question?: string,
): Promise<InsightSummaryResponse> {
  // 1. 作用域校验 + 查患者信息（未授权与不存在同为 404，不泄漏存在性）
  const scope = await assertPatientVisible(doctorId, patientId)
  const patients = await insightRepo.listPatientsWithStats(30, scope)
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

  // 3. 调编排层（文本链已配 key 走 LLM，否则离线降级）
  if (!isTextProviderConfigured()) {
    return runInsightSummaryOffline({ patient, tools, dateRange })
  }

  const ai = getAiClients()
  return runInsightSummary({ patient, tools, dateRange, question, ai })
}

/**
 * 生成队列摘要（POST /api/insight/queue-summary · T7.6）。
 * 数字全部来自工具计算结果（listPatientsWithStats / listRiskEventsWindow），
 * 咨询文本模型仅在链路末端做叙述，过 guardSummary 二次守门；无 key / LLM 失败走规则降级。
 */
export async function generateQueueSummary(doctorId: string, question?: string) {
  const days = 30
  const scope = await resolveDoctorPatientScope(doctorId)
  const patients = await insightRepo.listPatientsWithStats(days, scope)
  const windowRows = await insightRepo.listRiskEventsWindow(days, scope)

  const grades = countGrades(patients)
  const riskEvents = {
    total: windowRows.length,
    hasL4: windowRows.some((r) => r.level === 'L4'),
    hasL3: windowRows.some((r) => r.level === 'L3'),
  }
  // 字段最小化（ADR #17 第 5 条）：统计 + 差档名单（封顶 10，演示数据已脱敏），不带全量身份信息
  const payload: QueuePromptPayload = {
    dateRange: `${addDaysStr(todayStr(), -days + 1)} ~ ${todayStr()}`,
    total: patients.length,
    grades,
    poorPatientNames: patients
      .filter((p) => p.adherenceGrade === 'poor')
      .map((p) => p.name ?? '未命名')
      .slice(0, 10),
    riskEvents,
    question,
  }

  if (!isTextProviderConfigured()) {
    return runQueueSummaryOffline({ payload, grades, riskEvents })
  }
  const ai = getAiClients()
  return runQueueSummary({ payload, grades, riskEvents, ai })
}

// ---------------------------------------------------------------------------
// T7 医生端问答（POST /api/insight/ask · ADR #17 两级意图路由）
// ---------------------------------------------------------------------------

/** 生效计划集合的 drug_master.id（与 consult.service 同口径；interaction-check 数据路径用）。 */
async function resolveActiveMasterIds(userId: string): Promise<string[]> {
  const today = todayStr()
  const [planRows, drugRows] = await Promise.all([plansRepo.listPlans(userId), drugsRepo.listDrugs(userId)])
  return drugRows
    .filter((d) => d.drugMasterId && planRows.some((p) => p.drugId === d.id && isPlanActiveOn(p, today)))
    .map((d) => d.drugMasterId as string)
}

/**
 * 打卡时序聚合（内部实现）：patientId 的调用方负责可见性/归属校验。
 */
async function buildAdherenceSeries(
  patientId: string,
  days: number,
): Promise<InsightAdherenceSeriesResponse> {
  const [seriesData, stats] = await Promise.all([
    insightRepo.getAdherenceSeries(patientId, days),
    insightRepo.getAdherenceStats(patientId, days),
  ])
  return {
    patientId,
    days,
    startDate: seriesData.startDate,
    endDate: seriesData.endDate,
    series: seriesData.series,
    byDrug: seriesData.byDrug,
    adherence: {
      rate: stats.rate,
      taken: stats.taken,
      skipped: stats.skipped,
      total: stats.total,
    },
  }
}

/**
 * 患者自查打卡时序（GET /api/records/adherence-series）：patientId 由会话派生，不做医生作用域校验。
 * 与医生端 /api/insight/patients/:id/adherence-series 共用同一响应契约与聚合口径。
 */
export async function getSelfAdherenceSeries(
  patientId: string,
  days = 30,
): Promise<InsightAdherenceSeriesResponse> {
  return buildAdherenceSeries(patientId, days)
}

/**
 * 医生端患者下钻打卡时序（GET /api/insight/patients/:id/adherence-series · T7 图表卡片 · 0 次 LLM）。
 * specs/25：先校验该患者是否在当前医生的授权作用域内（未授权 404）。
 */
export async function getPatientAdherenceSeries(
  doctorId: string,
  patientId: string,
  days = 30,
): Promise<InsightAdherenceSeriesResponse> {
  await assertPatientVisible(doctorId, patientId)
  return buildAdherenceSeries(patientId, days)
}

/** 队列/患者数据路径 citation（与 insight 摘要 run 的字符串口径一致；consult 的 Citation 三件套不进医生端 ask）。 */
const QUEUE_CITATION = '本地队列数据（演示数据，未经医学审核）'
const PATIENT_CITATION = '本地患者数据（演示数据，未经医学审核）'

/**
 * 医生端问答编排主入口（T7 · ADR #17 第 2 条两级意图路由）：
 *   1. 提问过 scrubWithPatterns（L3 出口约束）——落库与送 LLM 绝不带原文 PII；
 *   2. 意图路由（宁漏勿误）：
 *      患者维度 → classifyConsultIntent（4 查询意图 + 解释类词仲裁）→ runDataQuery 直查库；
 *      队列维度 → classifyQueueIntent（3 工具意图 + 同一仲裁表）→ runQueueTool 直查库；
 *   3. 漏判长尾 → 复用既有摘要编排（咨询模型末端叙述 + guardSummary + 规则降级）；
 *   4. 每问一行 insight_ask_logs 留痕——intent=null 即漏判，作为扩工具依据（绝不放开 SQL）。
 */
export async function insightAsk(
  doctorId: string,
  question: string,
  patientId: string | null,
): Promise<InsightAskResponse> {
  const questionRedacted = scrubWithPatterns(question, PII_ASSERT_PATTERNS)
  const days = 30
  // specs/25：作用域从医生绑定关系派生（demo 模式 = undefined 全量）；患者维度先校验可见性。
  const scope = await resolveDoctorPatientScope(doctorId)

  let mode: 'data' | 'llm' | undefined
  let intent: string | null = null
  let toolUsed: string | null = null
  let sections: ConsultSections | undefined
  let riskLevel: RiskLevel = 'L1'
  let citations: string[] = []
  let notice: string | null = null

  // 患者可见性前置（未授权与不存在同为 404，与 summary 同口径；specs/25）
  if (patientId) {
    await assertPatientVisible(doctorId, patientId, scope)
  }

  // ── 患者维度：复用 consult 意图路由（解释类词仲裁内建；manual-gate 语义由 dataquery 边界保证）──
  if (patientId) {
    const qi = classifyConsultIntent(questionRedacted)
    if (qi) {
      const [activeMasterIds, ruleRows] = await Promise.all([
        resolveActiveMasterIds(patientId),
        assetsRepo.listInteractionRules(),
      ])
      const interactionRules: InteractionRuleInput[] = ruleRows.map((r) => ({
        id: r.id,
        drugIds: (r.drugIds as string[] | null) ?? [],
        drugGroups: (r.drugGroups as string[][] | null) ?? null,
        level: r.level,
        status: r.status,
        note: r.note,
        source: r.source,
      }))
      const drugNameById = await assetsRepo.findDrugMasterNames([...activeMasterIds])
      const result = await runDataQuery({
        userId: patientId,
        intent: qi,
        activeMasterIds,
        interactionRules,
        drugNameById,
      })
      mode = 'data'
      intent = qi
      toolUsed = qi
      sections = result.sections ?? undefined
      riskLevel = result.riskLevel
      citations = [PATIENT_CITATION]
      notice = result.notice ?? null
    }
  }

  // ── 队列维度：三工具意图 → runQueueTool（参数在注册表内过 safeParse）──
  if (!patientId && mode === undefined) {
    const qi = classifyQueueIntent(questionRedacted)
    if (qi) {
      mode = 'data'
      intent = qi
      citations = [QUEUE_CITATION]
      if (qi === 'adherence-distribution') {
        toolUsed = 'adherence_distribution'
        sections = renderAdherenceDistributionSections(
          (await runQueueTool('adherence_distribution', { days }, scope)) as AdherenceDistributionResult,
        )
      } else if (qi === 'poor-cohort') {
        toolUsed = 'patient_cohort'
        sections = renderPatientCohortSections(
          (await runQueueTool('patient_cohort', { grade: 'poor', days }, scope)) as PatientCohortResult,
        )
      } else {
        toolUsed = 'risk_event_rollup'
        sections = renderRiskEventRollupSections(
          (await runQueueTool('risk_event_rollup', { days }, scope)) as RiskEventRollupResult,
        )
      }
    }
  }

  // ── 长尾漏判 → LLM 叙述（既有摘要编排复用：数字全部来自工具，输出过 guardSummary）──
  if (mode === undefined) {
    mode = 'llm'
    if (patientId) {
      const result = await generateSummary(doctorId, patientId, questionRedacted)
      sections = result.sections
      riskLevel = result.riskLevel
      citations = result.citations
      notice = result.notice ?? null
    } else {
      const result = await generateQueueSummary(doctorId, questionRedacted)
      sections = result.sections
      riskLevel = result.riskLevel
      citations = result.citations
      notice = result.notice ?? null
    }
  }

  // 编排不变量：data/llm 任一路径都必须产出 sections（缺货即内部错误，错误可见不静默）
  if (!sections) {
    throw new ApiError(500, ERR_CODES.VALIDATION, '问答编排未产生回答')
  }

  // ── 留痕（每问一行；intent=null 即漏判信号）──
  await insightRepo.insertAskLog({
    id: newId('iask'),
    patientId,
    question: questionRedacted,
    mode,
    intent,
    toolUsed,
    answerSnapshot: sections,
    citations,
  })

  return {
    mode,
    riskLevel,
    sections,
    toolUsed,
    citations,
    notice,
    suggestions: ASK_SUGGESTIONS.filter((s) => (patientId ? s.scope === 'patient' : s.scope === 'queue')).map(
      (s) => s.text,
    ),
  }
}
