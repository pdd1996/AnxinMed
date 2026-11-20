/**
 * 说明书分段落页服务（2026-11-20）。
 *
 * 取数：用户药箱药品（userId 过滤）+ drug_master 直查说明书；manual 档按通用名兜底（同咨询口径）。
 * 组装：consult/leaflet.buildLeafletView（sourceSections 优先、typed 字段兜底、用法用量固定提示）。
 * 越权/不存在统一 404，不泄漏资源存在性。
 */

import type { Leaflet } from '@anxin/shared'
import * as assetsRepo from '../repositories/assets.repo.js'
import * as drugsRepo from '../repositories/drugs.repo.js'
import { nameMatches } from './identity/normalize.js'
import { toInsertSlice } from './consult/insert-slice.js'
import { buildLeafletView } from './consult/leaflet.js'

export async function getLeafletForDrug(userId: string, drugId: string): Promise<Leaflet | null> {
  const drug = await drugsRepo.findDrug(userId, drugId)
  if (!drug) return null

  let insertRow: assetsRepo.PackageInsertRow | undefined
  if (drug.drugMasterId) {
    insertRow = await assetsRepo.findPackageInsertByDrugMasterId(drug.drugMasterId)
  } else {
    const candidates = await assetsRepo.listPackageInsertsByGenericNameLike(drug.genericName)
    insertRow = candidates.find((c) => nameMatches(drug.genericName, c.genericName))
  }
  if (!insertRow) return null

  const insert = toInsertSlice(insertRow)
  const view = buildLeafletView(insert)
  return {
    drugId: drug.id,
    genericName: insert.genericName,
    brandName: insert.brandName ?? drug.brandName,
    specification: insert.specification ?? drug.specification,
    form: insert.form ?? drug.form,
    approvalNumbers: insert.approvalNumbers ?? null,
    source: insert.source || '本地说明书库（未标注来源）',
    version: insert.version || '未标注版本',
    curationStatus: insert.curationStatus,
    reviewed: insert.curationStatus === 'reviewed',
    notice: view.notice,
    sections: view.sections,
  }
}
