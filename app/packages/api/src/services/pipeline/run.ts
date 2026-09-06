/**
 * 管线编排（M2-T6 · 技术方案 §6 管线铁律）—— 串起 T1–T5 的独立纯函数，产出草稿载荷。
 *
 *   入口A 拍处方笺：①detectLayers(硬闸门) → assertLayersForEntry → ②runOcr → ③cropBody →
 *                   ④parseWhitelist → ⑥resolveFallback(回链) → ⑤sanitizeScan(最终白名单) →
 *                   身份线 extractIdentity + 每条目 matchDrugMaster → ⑦buildDraft（N 条目拆 N 份）
 *   入口B 拍药品：  ①detectLayers(硬闸门) → assertLayersForEntry → 身份线 → ⑦buildDraft（1 份建档，无用法用量）
 *
 * 降级：单步失败转 needsManual / degraded 标记，不炸整体（除 ①detectLayers —— 入口硬闸门，
 * AIUnavailable 冒泡由 intake.service 映射 503）。OCR 原文只在内存流转（L3），落库仅脱敏白名单 + 裁剪几何。
 * run.ts 不碰 DB：drug_master 候选 / 规则 / 说明书 / 生效集合均由 PipelineContext 注入。
 */
import { ERR_CODES, todayStr, type ConfirmStatus, type ErrCode, type LayerLabel } from '@anxin/shared'
import {
  AIUnavailableError,
  type AiClients,
  type IdentityFields,
  type ImageInput,
  type OcrResult,
} from '../../lib/ai/types.js'
import { cropBody, ocrToText, parseWhitelist, sanitizeScan } from '../sanitize/index.js'
import { resolveFallback } from '../backlink/index.js'
import { matchDrugMaster, type MatchResult } from '../identity/index.js'
import { checkDosageRange, checkInteractions } from '../rules/index.js'
import { assertLayersForEntry, layerSuggestion } from './layers.js'
import {
  buildDrugDraft,
  buildHealthSuggestions,
  buildItemIdentity,
  buildPlanDraft,
  pickLowConfidenceChars,
  toDraftConflicts,
} from './buildDraft.js'
import type { Degraded, DraftPayload, Entry, PipelineContext } from './types.js'

/** detect 结果（信息性，不抛错）。type 别名（非 interface）以满足 okJson 的 Record<string, unknown> 约束。 */
export type DetectResult = {
  layers: LayerLabel[]
  unsupported: boolean
  /** 提供了 entry 且与该入口不符时的切换/确认建议；否则 null。 */
  mismatch: string | null
}

/** 确认状态初判（确认页可改；confirm 入参携带最终值）：无唯一匹配→manual，有则按计划来源定档。 */
function defaultConfirmStatus(match: MatchResult | null, hasPlan: boolean): ConfirmStatus {
  if (!match || match.status === 'no_match') return 'manual'
  return hasPlan ? 'transcribed' : 'ocr_matched'
}

/** 某条目相关的人工补字段（从白名单 needsManual 里取 items[idx].* 子路径 → 字段名）。 */
function itemNeedsManual(allNeeds: string[], idx: number): string[] {
  const prefix = `items[${idx}].`
  return allNeeds.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length))
}

/** 降级草稿（OCR/裁剪/条目缺失等单步失败）：全 needsManual，绝不预填猜测。 */
function degradedDraft(
  entry: Entry,
  layers: LayerLabel[],
  code: ErrCode,
  message: string,
  extra?: Partial<DraftPayload>,
): DraftPayload {
  return {
    entry,
    type: entry === 'A' ? 'prescription' : 'drug',
    layers,
    needsManual: ['items', 'drugName', 'specification', 'quantity', 'usage'],
    drugDraft: {
      genericName: '',
      brandName: null,
      specification: null,
      form: null,
      manufacturer: null,
      drugMasterId: null,
      confirmStatus: 'manual',
    },
    planDraft: null,
    conflicts: [],
    healthSuggestions: [],
    interactions: { hits: [], coverageNote: null },
    dosageRange: { status: 'none', issues: [] },
    degraded: { code, message },
    ...extra,
  }
}

/** POST /api/intake/detect：仅层检测（入口校验独立暴露，不抛 409/422）。 */
export async function detectOnly(image: ImageInput, clients: AiClients, entry?: Entry): Promise<DetectResult> {
  const layers = await clients.detectLayers(image) // 硬闸门：AIUnavailable 冒泡
  const unsupported = layers.includes('不支持')
  const mismatch = entry && !unsupported ? layerSuggestion(entry, layers) : null
  return { layers, unsupported, mismatch }
}

/** 入口A 全管线 → N 份草稿（一张处方笺含 N 条目拆 N 份，PRD §7.2.1）。 */
export async function runPrescription(
  image: ImageInput,
  clients: AiClients,
  ctx: PipelineContext,
): Promise<DraftPayload[]> {
  // ① 层检测（硬闸门）+ 入口校验（不符 → 409 / 不支持 → 422）
  const layers = await clients.detectLayers(image)
  assertLayersForEntry('A', layers)

  // ② OCR（失败 → 降级：全 needsManual 草稿，不 503）
  let ocr: OcrResult
  try {
    ocr = await clients.runOcr(image)
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      return [degradedDraft('A', layers, ERR_CODES.OCR_FAILED, 'OCR 服务不可用，请核对处方原文手动补全，或改用手动建档')]
    }
    throw err
  }

  // ③ 裁剪（无 Rp 锚点 → null → 降级）
  const crop = cropBody(ocr)
  if (!crop) {
    return [
      degradedDraft('A', layers, ERR_CODES.PARSE_FAILED, '未定位到处方正文锚点（Rp / 处方完毕），请核对原文手动补全'),
    ]
  }

  // ④ 白名单解析（全文扫描头部；条目仅在正文区）
  const parse = parseWhitelist(ocrToText(ocr))
  // ⑥ 兜底 + 回链（仅当有缺项；只发 L0 正文）
  const fb = await resolveFallback(parse, crop.bodyText, clients)
  // ⑤ L2 脱敏（作用于回链合并后的最终白名单，合并值不逃逸 L2）
  const scanned = sanitizeScan(fb.whitelist)
  const whitelist = scanned.value
  const sanitizeAudit = scanned.audit

  // 身份线（VLM 提取；失败 → identity=null，逐项按 no_match 降级，不炸）
  let identity: IdentityFields | null = null
  try {
    identity = await clients.extractIdentity(image)
  } catch (err) {
    if (!(err instanceof AIUnavailableError)) throw err
    identity = null
  }

  const items = whitelist.items
  if (items.length === 0) {
    return [
      degradedDraft('A', layers, ERR_CODES.PARSE_FAILED, '未从处方正文提取到药品条目，请核对原文手动补全', {
        whitelist,
        sanitizeAudit,
        cropBox: crop.box,
        lowConfidenceChars: pickLowConfidenceChars(crop.chars),
        fallbackStatus: fb.fallbackStatus,
        backlinkIntercepted: fb.backlinkIntercepted,
        prescriptionNo: whitelist.prescriptionNo || null,
      }),
    ]
  }

  const lowConfidenceChars = pickLowConfidenceChars(crop.chars)
  const healthSuggestions = buildHealthSuggestions(whitelist)

  // ⑦ 逐条目装配 N 份草稿
  return items.map((item, idx) => {
    const effIdentity = buildItemIdentity(identity, item)
    const match = matchDrugMaster(effIdentity, ctx.candidates)
    const masterId = match.status === 'unique' && match.match ? match.match.id : null
    const planDraft = buildPlanDraft(item.usage, whitelist.date || todayStr())
    const insertSlice = masterId ? ctx.insertsByMasterId[masterId] ?? null : null
    const dosageRange = checkDosageRange({ dose: planDraft.dose, frequency: planDraft.frequency }, insertSlice)
    const masterIds = [...new Set([...ctx.activeMasterIds, ...(masterId ? [masterId] : [])])]
    const interactions = checkInteractions(masterIds, ctx.rules, ctx.drugNameById)

    return {
      entry: 'A',
      type: 'prescription',
      layers,
      whitelist,
      needsManual: itemNeedsManual(fb.needsManual, idx),
      sanitizeAudit,
      cropBox: crop.box,
      lowConfidenceChars,
      fallbackStatus: fb.fallbackStatus,
      backlinkIntercepted: fb.backlinkIntercepted,
      bodyImageRef: null,
      item,
      prescriptionNo: whitelist.prescriptionNo || null,
      identity: effIdentity,
      match,
      drugDraft: { ...buildDrugDraft(effIdentity, match), confirmStatus: defaultConfirmStatus(match, true) },
      planDraft,
      conflicts: toDraftConflicts(match),
      healthSuggestions,
      interactions,
      dosageRange,
      degraded: null,
    } satisfies DraftPayload
  })
}

/** 入口B 仅身份线 → 1 份建档草稿（药盒层永不提取用法用量；医院标签层 → labelNotice）。 */
export async function runDrug(image: ImageInput, clients: AiClients, ctx: PipelineContext): Promise<DraftPayload> {
  const layers = await clients.detectLayers(image) // 硬闸门
  assertLayersForEntry('B', layers)
  const labelNotice = layers.includes('医院标签层')

  let identity: IdentityFields | null = null
  let degraded: Degraded | null = null
  try {
    identity = await clients.extractIdentity(image)
  } catch (err) {
    if (!(err instanceof AIUnavailableError)) throw err
    degraded = {
      code: ERR_CODES.AI_UNAVAILABLE,
      message: '药品身份识别服务不可用，请核对药盒手动补全，或改用手动建档',
    }
  }

  const match: MatchResult = identity ? matchDrugMaster(identity, ctx.candidates) : { status: 'no_match' }
  const masterId = match.status === 'unique' && match.match ? match.match.id : null
  const masterIds = [...new Set([...ctx.activeMasterIds, ...(masterId ? [masterId] : [])])]
  const interactions = checkInteractions(masterIds, ctx.rules, ctx.drugNameById)
  // 入口B 无用法用量 → 无范围校验对象（none）
  const dosageRange = checkDosageRange({ dose: null, frequency: null }, null)

  return {
    entry: 'B',
    type: 'drug',
    layers,
    labelNotice,
    needsManual: identity ? [] : ['genericName', 'specification', 'form'],
    identity,
    match,
    drugDraft: { ...buildDrugDraft(identity, match), confirmStatus: defaultConfirmStatus(match, false) },
    // 结构保证：入口B 恒无计划草稿（payload 不含任何 dose/frequency/usage —— T10 结构断言依赖此）
    planDraft: null,
    conflicts: toDraftConflicts(match),
    healthSuggestions: [],
    interactions,
    dosageRange,
    degraded,
  } satisfies DraftPayload
}
