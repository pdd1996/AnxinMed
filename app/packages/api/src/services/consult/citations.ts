/**
 * 引用三件套（M3-T1 · PRD §7.5）——药名 + source + version。
 *
 * 两种来源：
 * - 本地说明书库（`insertCitation`）：unverified=false，来源三件套从 package_inserts 直接取；
 * - 本库数据直答（`dbCitation`）：unverified=false，来源标注本人三表。
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
 * 患者数据查询引用（意图路由 data-answered 路径 · 计划 T3）。
 * source 说明数据来自本人建档三表（drugs/plans/records）；version 用查询时刻 ISO 时间戳；
 * unverified=false——本库事实而非网络检索。
 */
export function dbCitation(queriedAt: Date = new Date()): Citation {
  return {
    drugName: '我的用药数据',
    source: '本地数据库（drugs/plans/records，仅本人可见）',
    version: queriedAt.toISOString(),
    unverified: false,
  }
}
