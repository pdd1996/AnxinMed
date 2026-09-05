/**
 * @anxin/shared —— 前后端一份真相（执行总纲 §3.1）。
 *
 * 包边界：shared 不依赖任何其他包；api 与 web 都只依赖 shared。
 * M1-T2：建立骨架（占位导出，验证跨包链接与 Vite/tsx 对 shared 源码的转译）。
 * M1-T4：填入领域类型 / 枚举 / 常量 / zod schema / 纯函数
 *         （底本 demo/src/types.ts + demo/src/lib.ts，按总纲 §2.5 对齐目标枚举）。
 */

/** 产品名。占位导出，用于 T2 验证 api/web 跨包导入链路；T4 起补充领域契约。 */
export const APP_NAME = '安心用药'
