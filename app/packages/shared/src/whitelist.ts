/**
 * 处方白名单闭合 schema —— 脱敏 L1（PRD §7.2.2 / 技术方案 §7 / 执行总纲 §3.2.3）。
 *
 * .strict()：schema 之外无字段可装身份信息（结构性封顶），身份信息结构上无法进入。
 * M2 医嘱线 parseWhitelist 的输出契约；一切模型兜底解析也必须过此 schema 的 safeParse 才使用。
 */
import { z } from 'zod'

/** 处方条目（单味药）：药名 / 规格 / 数量 / 用法用量 —— 闭合，无患者身份字段 */
export const PrescriptionItemSchema = z
  .object({
    drugName: z.string(),
    specification: z.string(),
    quantity: z.string(),
    usage: z.string(),
  })
  .strict()
export type PrescriptionItem = z.infer<typeof PrescriptionItemSchema>

/** 处方白名单（闭合）：医院 / 处方号 / 日期 / 科室 / 诊断 / 条目[] */
export const PrescriptionWhitelist = z
  .object({
    hospital: z.string(),
    prescriptionNo: z.string(),
    date: z.string(),
    department: z.string(),
    diagnosis: z.string(),
    items: z.array(PrescriptionItemSchema),
  })
  .strict()
export type PrescriptionWhitelistType = z.infer<typeof PrescriptionWhitelist>
