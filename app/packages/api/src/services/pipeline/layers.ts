/**
 * 层检测入口校验（M2-T6 · PRD §7.2 / V2.1 贴标降级）—— 纯函数。
 *
 * 层检测是「入口校验」而非分流：检测结果与所选入口不符 → 409 LAYER_MISMATCH（不静默改道，交用户确认/切换）；
 * 不支持对象（散装药片等）→ 422 UNSUPPORTED_OBJECT + 统一安全提示文案。
 * 文案参照 demo/server/index.js 的 entryWarning（已验证），升级为抛错分支 + 信息性建议两套出口。
 */
import { ERR_CODES, type LayerLabel } from '@anxin/shared'
import { ApiError } from '../../lib/http.js'
import type { Entry } from './types.js'

/** 不支持对象的统一安全提示文案（PRD：明确不支持 + 引导手动建档/咨询药师）。 */
export const UNSUPPORTED_HINT =
  '层检测不支持该对象（如散装药片）。请勿根据无法识别的内容服药，可通过「手动建档」录入，或咨询药师。'

const has = (layers: LayerLabel[], label: LayerLabel): boolean => layers.includes(label)

/** 入口B 是否命中可识别的药品包装（药盒原装层或医院标签层）。 */
function hasDrugPackage(layers: LayerLabel[]): boolean {
  return has(layers, '药盒原装层') || has(layers, '医院标签层')
}

/**
 * 入口校验建议（信息性，不抛错）：检测结果与所选入口不符时给出「确认/切换」提示；相符或不支持返回 null。
 * 供 POST /api/intake/detect 附带返回（前端纠正 UI），照搬 demo entryWarning 文案。
 */
export function layerSuggestion(entry: Entry, layers: LayerLabel[]): string | null {
  if (has(layers, '不支持')) return null
  if (entry === 'A') {
    if (!has(layers, '处方层')) {
      if (hasDrugPackage(layers)) {
        return `检测到${layers.join('、')}，未检测到处方层。你选择的是「拍处方笺」，是否切换到「拍药品」入口？`
      }
      return '未在图片中检测到处方内容。你选择的是「拍处方笺」，请确认拍摄的是平铺完整、覆盖 Rp 至处方完毕的处方笺。'
    }
    return null
  }
  if (!hasDrugPackage(layers)) {
    if (has(layers, '处方层')) return '检测到处方层。你选择的是「拍药品」，是否切换到「拍处方笺」入口？'
    return '未检测到可识别的药品包装或医院标签，请补拍正面清晰的药盒。'
  }
  return null
}

/**
 * 入口校验（抛错分支）：
 *   - 含「不支持」→ 422 UNSUPPORTED_OBJECT（统一安全提示 + detected）；
 *   - 入口A 须含「处方层」、入口B 须含「药盒原装层」或「医院标签层」，不符 → 409 LAYER_MISMATCH（detected + suggestion）。
 */
export function assertLayersForEntry(entry: Entry, layers: LayerLabel[]): void {
  if (has(layers, '不支持')) {
    throw new ApiError(422, ERR_CODES.UNSUPPORTED_OBJECT, UNSUPPORTED_HINT, { detected: layers })
  }
  const ok = entry === 'A' ? has(layers, '处方层') : hasDrugPackage(layers)
  if (!ok) {
    const suggestion = layerSuggestion(entry, layers)
    throw new ApiError(409, ERR_CODES.LAYER_MISMATCH, suggestion ?? '层检测结果与所选入口不符，请确认或切换入口', {
      detected: layers,
      suggestion,
    })
  }
}
