/**
 * 脱敏 L1 · 白名单解析（PRD §7.2.2 步骤3 / §12.2 L1）。
 *
 * 输出为**闭合 schema**（shared PrescriptionWhitelist，`.strict()`）：{医院, 处方号, 日期, 科室, 诊断, 条目[]}。
 * schema 之外没有任何字段——患者姓名/电话/地址/病历号等身份信息**结构上无法进入**（结构性封顶）。
 *
 * 解析以正则模板为主（"每次X / 每日X次 / 共X天"，照搬并扩充 demo parseSig/parseDrugLine/parsePrescriptionText）；
 * 抽不出的字段一律标 needsManual（不猜、不预填），原文由确认页人工补（PRD §7.2.5 唯一闸门）。
 *
 * 输入 `text` 为 OCR 重建的处方全文（见 crop.ts ocrToText）：头部字段（医院/日期/诊断…）从全文扫描，
 * **条目仅在 Rp..处方完毕 正文区解析**（demo L0 文本等价），前记后记的条目噪声不会混入。
 */
import {
  PrescriptionWhitelist,
  type PrescriptionItem,
  type PrescriptionWhitelistType,
} from '@anxin/shared'
import { toHalfWidth } from './normalize.js'
import { isStartAnchor, isEndAnchor } from './anchors.js'

/** 用法用量结构化中间态（仅用于识别用法行并归属到条目；落库仍以原文 usage 字符串抄录）。 */
interface Sig {
  dose?: { value: number; unit: string }
  frequency?: number
  durationDays?: number
  route?: string
}

export interface ParseResult {
  /** 闭合白名单：永远只含 schema 内字段，身份信息无法进入。 */
  whitelist: PrescriptionWhitelistType
  /** 未解析出的字段路径（如 'hospital' / 'items[0].usage'）——确认页据此展示原文空输入，绝不预填。 */
  needsManual: string[]
  /** needsManual 为空即解析完整。 */
  complete: boolean
}

/** 用法用量模板解析（照搬 demo parseSig，扩充单位/途径词表）。 */
export function parseSig(text: string): Sig {
  const raw = String(text ?? '')
  const sig: Sig = {}
  const dose = raw.match(/(?:每次|一次|每回)\s*([\d.]+)\s*(滴|片|粒|支|袋|喷|丸|匙|ml|毫升|mg|毫克|g|克)/i)
  if (dose) {
    sig.dose = {
      value: Number(dose[1]),
      unit: dose[2].replace('毫克', 'mg').replace('克', 'g').replace('毫升', 'ml'),
    }
  }
  const freq = raw.match(/(?:每日|一日|每天)\s*(\d+)\s*次/)
  if (freq) sig.frequency = Number(freq[1])
  const dur = raw.match(/(?:共|疗程|连服|服用)\s*(\d+)\s*天/)
  if (dur) sig.durationDays = Number(dur[1])
  const route = raw.match(
    /(口服|滴眼|滴入|外用|静脉滴注|静脉注射|肌内注射|皮下注射|雾化吸入|舌下含服|含服|直肠给药|局部涂抹|睡前服)/,
  )
  if (route) sig.route = route[1]
  return sig
}

/** 药品明细行解析（照搬 demo parseDrugLine）：药名必得，规格/数量缺则留空（走 needsManual，不猜）。 */
export function parseDrugLine(line: string): { name: string; spec: string; quantity: string } | null {
  const tokens = String(line ?? '').split(/\s+/).filter(Boolean)
  const name = tokens.find(
    (t) =>
      /^[\u4e00-\u9fa5]/.test(t) &&
      /滴眼液|滴眼|注射液|注射用|口服液|口服|片|胶囊|颗粒|丸|栓|膏|贴|喷|吸入|混悬|散|糖浆|合剂|滴丸|缓释|分散/.test(t),
  )
  if (!name) return null
  const spec = tokens.find((t) => /\d/.test(t) && /%|mg|g|ml|μg|ug|iu|单位|万/i.test(t))
  const qty = String(line ?? '').match(/[×xX*]\s*(\d+)\s*([\u4e00-\u9fa5]{1,2})?/)
  return {
    name,
    spec: spec ?? '',
    quantity: qty ? `${qty[1]}${qty[2] ?? ''}` : '',
  }
}

/** 是否为用法用量行：以「用法/Sig」起头，或同时解析出剂量+频次（照搬 demo isSigLine 判据）。 */
function isSigLine(line: string, sig: Sig): boolean {
  return /^(用法|Sig|sig)/i.test(line) || (sig.dose != null && sig.frequency != null)
}

/**
 * L1 白名单解析（纯函数）。
 * @param text OCR 重建的处方全文（含前记/正文/后记）；身份信息因闭合 schema 无字段可装而被结构性挡在外面。
 */
export function parseWhitelist(text: string): ParseResult {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  let hospital = ''
  let prescriptionNo = ''
  let date = ''
  let department = ''
  let diagnosis = ''

  // 头部字段：全文扫描（demo parsePrescriptionText 同源正则，扩充机构/编号词表 + 全角数字容错）
  for (const line of lines) {
    if (!hospital) {
      const m = line.match(/([\u4e00-\u9fa5]{2,16}(?:医院|卫生院|门诊部|诊所|保健院|卫生服务中心|医疗中心))/)
      if (m) hospital = m[1]
    }
    if (!prescriptionNo) {
      const m = line.match(/(?:处方号|处方编号|处方号码|编号|No\.?)[：:]\s*([A-Za-z0-9-]{4,20})/)
      if (m) prescriptionNo = m[1]
    }
    if (!date) {
      const m = toHalfWidth(line).match(/(\d{4})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})/)
      if (m) date = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
    }
    if (!department) {
      const m = line.match(/(?:科室|科别|科)[：:]\s*([\u4e00-\u9fa5]{1,10})/)
      if (m) department = m[1]
    }
    if (!diagnosis) {
      const m = line.match(/(?:临床诊断|诊断)[：:]\s*(.+)/)
      if (m) diagnosis = m[1].trim()
    }
  }

  // 条目：仅在 Rp..处方完毕 正文区解析（前记后记整块不进入条目——demo L0 文本等价）
  const items: PrescriptionItem[] = []
  const startIdx = lines.findIndex((l) => isStartAnchor(l))
  if (startIdx >= 0) {
    let endIdx = -1
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (isEndAnchor(lines[i])) {
        endIdx = i
        break
      }
    }
    const body = lines.slice(startIdx + 1, endIdx > startIdx ? endIdx : lines.length)
    for (const line of body) {
      const sig = parseSig(line)
      if (isSigLine(line, sig) && items.length > 0) {
        // 用法用量归属到上一条目；usage 存**原文**（抄录不生成，§3.2.2）
        const item = items[items.length - 1]
        item.usage = item.usage ? `${item.usage} ${line}` : line
        continue
      }
      const drug = parseDrugLine(line)
      if (drug) {
        items.push({ drugName: drug.name, specification: drug.spec, quantity: drug.quantity, usage: '' })
      }
    }
  }

  // needsManual：解析不全的字段一律标记，绝不预填猜测
  const needsManual: string[] = []
  if (!hospital) needsManual.push('hospital')
  if (!prescriptionNo) needsManual.push('prescriptionNo')
  if (!date) needsManual.push('date')
  if (!department) needsManual.push('department')
  if (!diagnosis) needsManual.push('diagnosis')
  if (items.length === 0) needsManual.push('items')
  items.forEach((it, i) => {
    if (!it.drugName) needsManual.push(`items[${i}].drugName`)
    if (!it.specification) needsManual.push(`items[${i}].specification`)
    if (!it.quantity) needsManual.push(`items[${i}].quantity`)
    if (!it.usage) needsManual.push(`items[${i}].usage`)
  })

  const candidate = { hospital, prescriptionNo, date, department, diagnosis, items }
  // 结构性封顶自证：输出必须过闭合 schema safeParse（越界字段会被拒 → 抛错暴露，绝不静默）
  const parsed = PrescriptionWhitelist.safeParse(candidate)
  if (!parsed.success) {
    throw new Error(`白名单解析输出越界（不应发生，闭合 schema 拒绝）：${parsed.error.message}`)
  }

  return { whitelist: parsed.data, needsManual, complete: needsManual.length === 0 }
}
