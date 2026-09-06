/**
 * 服务层通用小工具。
 */
import { randomUUID } from 'node:crypto'
import type { ImageInput } from './ai/types.js'

/** 生成带前缀的唯一 id，如 `drug-<uuid>` / `plan-<uuid>` / `src-<uuid>`。 */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

/** 去掉对象中值为 undefined 的键（保留 null）——用于 PATCH 部分更新，避免把未提供字段写成 undefined。 */
export function compact<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

/**
 * 解析 dataURL 图片为 ImageInput（base64 + mime）。
 * 路由层 vJson 已按 dataURL 正则校验，此处兜底拆解；非法格式抛错（不静默）。
 */
export function parseDataUrlImage(dataUrl: string): ImageInput {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(String(dataUrl ?? '').trim())
  if (!m) throw new Error('图片 dataURL 格式非法（需 data:image/...;base64,<data>）')
  return { mime: m[1], base64: m[2] }
}
