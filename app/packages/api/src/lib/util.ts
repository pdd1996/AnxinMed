/**
 * 服务层通用小工具。
 */
import { randomUUID } from 'node:crypto'

/** 生成带前缀的唯一 id，如 `drug-<uuid>` / `plan-<uuid>` / `src-<uuid>`。 */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

/** 去掉对象中值为 undefined 的键（保留 null）——用于 PATCH 部分更新，避免把未提供字段写成 undefined。 */
export function compact<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}
