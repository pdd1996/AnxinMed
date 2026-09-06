/**
 * 模型输出 zod schema（M2-T1）。一切模型输出必须 safeParse 通过才使用（执行总纲 §3.2.3）。
 * 这些是「模型 → 本系统」的边界契约；API 传输契约在 shared。
 */
import { z } from 'zod'
import { LayerLabelSchema } from '@anxin/shared'

/** 层检测：模型输出标签数组（多选）。 */
export const LayersOutputSchema = z.array(LayerLabelSchema)

/** 身份线提取：药名必填，其余可选；结构上不含任何用法用量字段（药盒层永不抄录）。 */
export const IdentityExtractSchema = z.object({
  genericName: z.string().min(1),
  brandName: z.string().optional(),
  specification: z.string().optional(),
  form: z.string().optional(),
  manufacturer: z.string().optional(),
  otcFlag: z.boolean().optional(),
  approvalNumber: z.string().optional(),
})

/** OCR 字符级结果（硬要求：字符级置信度 + 坐标）。 */
export const OcrResultSchema = z.object({
  chars: z.array(
    z.object({
      text: z.string(),
      confidence: z.number(),
      box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    }),
  ),
})

/** 兜底解析：字段键 → 值（后续须过回链校验才可用）。 */
export const FallbackParseSchema = z.record(z.string())
