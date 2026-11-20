/**
 * package_inserts 行 → InsertSlice（裁剪到咨询/说明书分段所需列）。
 * 2026-11-20：从 consult.service 抽出，供咨询与「查看完整说明书」分段页共用一份映射。
 */

import type * as assetsRepo from '../../repositories/assets.repo.js'
import type { InsertSlice } from './types.js'

/** package_inserts 行 → InsertSlice。 */
export function toInsertSlice(row: assetsRepo.PackageInsertRow): InsertSlice {
  return {
    drugId: row.drugId,
    genericName: row.genericName,
    brandName: row.brandName,
    specification: row.specification,
    approvalNumbers: row.approvalNumbers,
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
    sourceSections: row.sourceSections ?? null,
    curationStatus: row.curationStatus,
  }
}
