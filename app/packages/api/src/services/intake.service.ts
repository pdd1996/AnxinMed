/**
 * 录入服务（M2-T6）—— intake API 的业务编排：组 PipelineContext（DB 取数）→ 调管线 run.ts → 落草稿。
 *
 * run.ts 是纯编排（不碰 DB），本服务负责：① 从仓储取候选/规则/说明书/生效集合注入；② 把 N 份 DraftPayload
 * 落库为 N 行 drafts（PRD §7.2.1）；③ 把 detectLayers 冒泡的 AIUnavailableError 映射为 503（引导手动建档）。
 * 409 LAYER_MISMATCH / 422 UNSUPPORTED_OBJECT 由 run.ts 内 assertLayersForEntry 抛出，原样透传。
 */
import { isPlanActiveOn, todayStr, ERR_CODES } from '@anxin/shared'
import { AIUnavailableError, type AiClients, type ImageInput } from '../lib/ai/types.js'
import { ApiError } from '../lib/http.js'
import { newId } from '../lib/util.js'
import { Stopwatch, type TimingSummary } from '../lib/timing.js'
import * as assetsRepo from '../repositories/assets.repo.js'
import * as drugsRepo from '../repositories/drugs.repo.js'
import * as plansRepo from '../repositories/plans.repo.js'
import * as draftsRepo from '../repositories/drafts.repo.js'
import {
  detectOnly,
  runDrug,
  runPrescription,
  type DetectResult,
  type DraftPayload,
  type Entry,
  type PipelineContext,
} from './pipeline/index.js'
import type { InteractionRuleInput, PackageInsertDosage } from './rules/index.js'

/** 草稿概要（intake 响应列表项；详情走 GET /api/drafts/:id）。 */
export interface DraftSummary {
  id: string
  type: 'prescription' | 'drug'
  drugName: string
  matchStatus: string | null
  needsManual: number
  labelNotice: boolean
  degraded: { code: string; message: string } | null
}

export type IntakeResult = {
  draftIds: string[]
  drafts: DraftSummary[]
}

/** detectLayers 冒泡的 AI 不可用 → 503（引导手动建档）；其余（含 ApiError 409/422）原样抛。 */
function rethrowMapped(err: unknown): never {
  if (err instanceof AIUnavailableError) {
    throw new ApiError(503, ERR_CODES.AI_UNAVAILABLE, '识别服务暂不可用，请稍后重试，或改用「手动建档」录入')
  }
  throw err
}

/**
 * 结构化打点日志（M3-T5 · spec §T5.1）：单行 JSON，含入口/草稿数/总墙钟/各阶段耗时。
 * 不含用户数据/原文（执行总纲 §0.5）；测试环境静默（避免噪音），dev/prod 恒输出供 P50/P95 采样。
 */
function logIntakeTiming(entry: 'A' | 'B', summary: TimingSummary, drafts: number): void {
  if (process.env.NODE_ENV === 'test') return
  console.log(`[intake:timing] ${JSON.stringify({ entry, drafts, ...summary })}`)
}

/** 组管线上下文：drug_master 候选 / 规则 / 说明书切片 / 用户现有生效计划的 masterIds（相互作用生效集合基线）。 */
export async function gatherContext(userId: string): Promise<PipelineContext> {
  const [candidates, ruleRows, insertRows, drugRows, planRows] = await Promise.all([
    assetsRepo.listDrugMasterCandidates(),
    assetsRepo.listInteractionRules(),
    assetsRepo.listPackageInsertSlices(),
    drugsRepo.listDrugs(userId),
    plansRepo.listPlans(userId),
  ])

  const rules: InteractionRuleInput[] = ruleRows.map((r) => ({
    id: r.id,
    drugIds: (r.drugIds as string[] | null) ?? [],
    level: r.level,
    note: r.note,
    source: r.source,
  }))
  const drugNameById = Object.fromEntries(candidates.map((c) => [c.id, c.genericName]))
  const today = todayStr()
  const activeMasterIds = drugRows
    .filter((d) => d.drugMasterId && planRows.some((p) => p.drugId === d.id && isPlanActiveOn(p, today)))
    .map((d) => d.drugMasterId as string)
  const insertsByMasterId: Record<string, PackageInsertDosage> = {}
  for (const r of insertRows) {
    insertsByMasterId[r.drugId] = {
      dosage: r.dosage as PackageInsertDosage['dosage'],
      source: r.source,
      version: r.version,
    }
  }
  return { candidates, rules, drugNameById, activeMasterIds, insertsByMasterId }
}

function toSummary(p: DraftPayload, id: string): DraftSummary {
  return {
    id,
    type: p.type,
    drugName: p.drugDraft.genericName || p.item?.drugName || '',
    matchStatus: p.match?.status ?? null,
    needsManual: p.needsManual.length,
    labelNotice: p.labelNotice ?? false,
    degraded: p.degraded,
  }
}

/** 逐份落库为 drafts 行（status=pending），返回 id 列表 + 概要。 */
async function persistDrafts(userId: string, payloads: DraftPayload[]): Promise<IntakeResult> {
  const summaries: DraftSummary[] = []
  const draftIds: string[] = []
  for (const payload of payloads) {
    const row = await draftsRepo.insertDraft({
      id: newId('draft'),
      userId,
      type: payload.type,
      status: 'pending',
      payload,
    })
    draftIds.push(row.id)
    summaries.push(toSummary(payload, row.id))
  }
  return { draftIds, drafts: summaries }
}

/** POST /api/intake/detect：仅层检测（信息性，不落库）。 */
export async function detect(image: ImageInput, clients: AiClients, entry?: Entry): Promise<DetectResult> {
  try {
    return await detectOnly(image, clients, entry)
  } catch (err) {
    rethrowMapped(err)
  }
}

/** POST /api/intake/prescription：入口A 全管线 → N 份草稿落库。timing 可注入（测量工具），缺省自建并落结构化日志。 */
export async function intakePrescription(
  userId: string,
  image: ImageInput,
  clients: AiClients,
  timing: Stopwatch = new Stopwatch(),
): Promise<IntakeResult> {
  const ctx = await timing.measureAsync('gatherContext', () => gatherContext(userId))
  let payloads: DraftPayload[]
  try {
    payloads = await runPrescription(image, clients, ctx, timing)
  } catch (err) {
    rethrowMapped(err)
  }
  const result = await timing.measureAsync('persist', () => persistDrafts(userId, payloads))
  logIntakeTiming('A', timing.summarize(), result.drafts.length)
  return result
}

/** POST /api/intake/drug：入口B 仅身份线 → 1 份建档草稿落库。timing 可注入（测量工具），缺省自建并落结构化日志。 */
export async function intakeDrug(
  userId: string,
  image: ImageInput,
  clients: AiClients,
  timing: Stopwatch = new Stopwatch(),
): Promise<IntakeResult> {
  const ctx = await timing.measureAsync('gatherContext', () => gatherContext(userId))
  let payload: DraftPayload
  try {
    payload = await runDrug(image, clients, ctx, timing)
  } catch (err) {
    rethrowMapped(err)
  }
  const result = await timing.measureAsync('persist', () => persistDrafts(userId, [payload]))
  logIntakeTiming('B', timing.summarize(), result.drafts.length)
  return result
}
