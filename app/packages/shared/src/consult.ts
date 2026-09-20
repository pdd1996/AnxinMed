/**
 * AI 咨询契约（M4-T1 · specs/04-T1）——快捷问题与技能 ID，前后端一份真相。
 *
 * 背景：web 的快捷 chips 此前是前端常量，文案与后端 intent.ts 正则靠人工逐条对齐
 * （「改文案必须同步核对后端正则」的脆弱耦合）。本契约收编后，chips 渲染与后端路由同源：
 * 改文案只动本文件一处；skillId 为 specs/04 技能注册表的行键（T7 快路径直达，跳过正则）。
 *
 * 包边界纪律（执行总纲 §3.1）：shared 不依赖其他包，故意图类型真相在 shared 定义、
 * api 的 intent.ts 引用此类型（正则本体仍留在 api——避免 web 误把正则当前端预判用）。
 */

/**
 * S2 数据直答意图（api consult/intent.ts 的 INTENT_ROUTES 正则路由落点）。
 * next-dose（今日待服）为 M4-T7 增补的第 5 意图。
 */
export type ConsultQueryIntent =
  | 'medication-list'
  | 'adherence'
  | 'expiry-stock'
  | 'interaction-check'
  | 'next-dose'

/**
 * 咨询技能 ID（specs/04-T3 技能注册表行键）：
 * - `s1-insert`：S1 说明书问答（对象药解释类，按键取数 → LLM/降级）；
 * - `s2-<intent>`：S2 数据直答的具体意图行（直查库 0 次 LLM）。
 * S0 红线（守门）与 S3 搜索兜底不是 chips 可达技能，不入此联合。
 */
export type ConsultSkillId = 's1-insert' | `s2-${ConsultQueryIntent}`

/** 快捷问题（chips 契约，specs/04-T1）：web 渲染 label、发送 question；skillId 供 T7 快路径。 */
export interface QuickQuestion {
  /** 按钮文案（chips 横滑条展示）。 */
  label: string
  /** 点击后发送的提问原文（走 POST /api/consult 的 question）。 */
  question: string
  /** 目标技能（技能注册表行键）。 */
  skillId: ConsultSkillId
  /** S2 行的查询意图（与 skillId 的 `s2-<intent>` 后缀一致；消费方可直读免解析）。 */
  intent?: ConsultQueryIntent
}

/**
 * 快捷问题 · 药箱数据类（S2 数据直答；无需对象药，始终渲染）。
 * 文案与 api intent.ts 的 INTENT_ROUTES 正则已逐条核对（慢路径也命中同意图）；
 * 后续改文案只动本文件——chips 渲染、skillId 快路径、正则回归测试同源于此。
 */
export const CONSULT_DATA_QUICK_QUESTIONS: readonly QuickQuestion[] = [
  {
    label: '我现在有多少药物？',
    question: '我现在有多少药物？',
    skillId: 's2-medication-list',
    intent: 'medication-list',
  },
  {
    label: '今天我要吃哪些药？',
    question: '今天我要吃哪些药？',
    skillId: 's2-next-dose',
    intent: 'next-dose',
  },
  {
    label: '我的依从性怎么样？',
    question: '我的依从性怎么样？',
    skillId: 's2-adherence',
    intent: 'adherence',
  },
  {
    label: '有什么药快过期或快用完了？',
    question: '有什么药快过期或快用完了？',
    skillId: 's2-expiry-stock',
    intent: 'expiry-stock',
  },
  {
    label: '我的药一起吃有冲突吗？',
    question: '我的药一起吃有冲突吗？',
    skillId: 's2-interaction-check',
    intent: 'interaction-check',
  },
]

/** 快捷问题 · 说明书类（S1 说明书问答；需对象药深链 /consult?drugId=… 带入时才渲染）。 */
export const CONSULT_INSERT_QUICK_QUESTIONS: readonly QuickQuestion[] = [
  { label: '这个药通常用于什么？', question: '这个药通常用于什么？', skillId: 's1-insert' },
  { label: '常见不良反应有哪些？', question: '常见不良反应有哪些？', skillId: 's1-insert' },
  { label: '这个药是怎么作用的？（药理机制）', question: '这个药是怎么作用的？（药理机制）', skillId: 's1-insert' },
  { label: '这个药应该怎么保存？', question: '这个药应该怎么保存？', skillId: 's1-insert' },
]
