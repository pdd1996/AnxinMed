import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn/ui 约定的类名合并助手：clsx 组合 + tailwind-merge 去冲突。
 * components.json 的 aliases.utils 指向此文件（@/lib/utils）。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
