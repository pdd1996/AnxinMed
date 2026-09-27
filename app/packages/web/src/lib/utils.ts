/**
 * shadcn/ui 的类名合并助手别名（components.json 的 aliases.utils 指向本文件，ui/* 组件按上游原样引用）。
 * 实现唯一真相在 @anxin/core（M5-T2 迁入，RN 侧共用），此处只做别名转口，不留第二份实现。
 */
export { cn } from '@anxin/core'
