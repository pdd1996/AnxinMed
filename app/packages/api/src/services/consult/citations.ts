/**
 * 引用三件套（M3-T1 · PRD §7.5）——药名 + source + version。
 *
 * 两种来源：
 * - 本地说明书库（`insertCitation`）：unverified=false，来源三件套从 package_inserts 直接取；
 * - 网络检索兜底（`webSearchCitation`）：unverified=true，前端渲染"未经本库核实"徽章。
 *
 * ⚠️ citations 是 PRD §7.5 硬约束——L1 正常回答必含三件套；缺 source/version 视为回答不完整。
 */
import type { Citation, InsertSlice } from './types.js'

/** 本地说明书库引用（三件套齐备；缺失字段以"未标注"兜底，不留空）。 */
export function insertCitation(insert: InsertSlice): Citation {
  return {
    drugName: insert.genericName,
    source: insert.source || '本地说明书库（未标注来源）',
    version: insert.version || '未标注版本',
    unverified: false,
  }
}

/**
 * 网络检索兜底引用（PRD §7.5：本地未命中且 ENABLE_MEDICAL_SEARCH=true 才触发）。
 * version 用检索时间戳（ISO 秒级），unverified=true 强制前端渲染"未经本库核实"徽章。
 */
export function webSearchCitation(drugName: string, retrievedAt: Date = new Date()): Citation {
  return {
    drugName,
    source: 'Baichuan 医疗搜索（网络检索）',
    version: retrievedAt.toISOString().slice(0, 19).replace('T', ' '),
    unverified: true,
  }
}
