/**
 * @anxin/shared —— 前后端一份真相（执行总纲 §3.1）。
 *
 * 包边界：shared 不依赖任何其他包；api 与 web 都只依赖 shared（web 不直接 import api 的代码）。
 * 内容：领域枚举 / 元数据 / 纯函数 / DTO 与白名单 zod schema / 错误码。
 * M1-T4 立契约；后续里程碑在此扩充，禁止把领域真相散落到 api/web。
 */

/** 产品名。 */
export const APP_NAME = '安心用药'

export * from './enums.js'
export * from './lib.js'
export * from './errors.js'
export * from './dto.js'
export * from './inputs.js'
export * from './whitelist.js'
export * from './drafts.js'
