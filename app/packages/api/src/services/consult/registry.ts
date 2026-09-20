/**
 * 技能注册表（M4-T3 · specs/04-T3）——「注册表 + 分发」，把 consult.service.ts 的 if-else
 * 编排显式化为纯函数路由。**零行为变更**：判定正则、优先级顺序、开关语义与 M3 验收实现逐字一致。
 *
 * 四个技能（docs/10 §5 注册表单 · 08 附录 A 意图路由）：
 *   S0 红线        guardConsult 的 L4 emergency / L3 refused（守门优先于意图路由——
 *                  混合句「我胸痛，还有多少药」必须走 L4，绝不被数据查询意图截胡）
 *   S1 说明书问答  runConsult 路径（manual-gate 为 S1 内部门禁，非独立技能；
 *                  proceed → 按键取数 → Baichuan → 归一化）
 *   S2 数据直答    classifyConsultIntent 命中 → runDataQuery 只读工具（0 次 LLM）
 *   S3 搜索兜底    S1 内部 no-source 分支且 ENABLE_MEDICAL_SEARCH 开（Baichuan 医疗搜索，
 *                  必标「未经本库核实」）——判定依赖 drugs 上下文与 env，留在 run.ts，
 *                  注册表仅声明其从属关系与降级文案，不做路由返回值
 *
 * ⚠️ 分发纪律：S0 与 S1 都执行 runConsult——守门判定与 risk_events 留痕单点在 guards.ts +
 *    run.ts，本注册表只决定「是否先试 S2」，绝不复制守门逻辑（避免双处判定漂移）。
 * ⚠️ 顺序即语义（与 service 层既有注释一致）：L4 > L3 > S2 > S1{manual-gate > no-source(+S3) > proceed}；
 *    数据查询是 L0 以下的事实读取（读本库 drugs/plans/records），不受 manual-gate 限制，
 *    故 S2 先于 S1 内部的 manual-gate 判定。
 */
import { detectEmergency, detectProhibited } from './guards.js'
import { classifyConsultIntent, type QueryIntent } from './intent.js'

/** 技能 ID（注册表行键；docs/10 §5 的 S0–S3 编号）。 */
export type SkillId = 'S0' | 'S1' | 'S2' | 'S3'

/** 路由决策（纯函数产物，执行层据此分发）。 */
export type SkillRouteDecision =
  | { skill: 'S0'; kind: 'emergency' | 'refused'; matched: string }
  | { skill: 'S2'; intent: QueryIntent }
  | { skill: 'S1' }

/** routeSkill 入参（纯函数；question 须已过 L3 出口脱敏，env 开关由调用方读好后传入布尔值）。 */
export interface SkillRouteInput {
  question: string
  /** env ENABLE_INTENT_ROUTE（默认开；显式 =false 才关——一行整体回滚语义不变）。 */
  intentRouteEnabled: boolean
  /** 技能快路径（M4-T7）：chips/深链显式携带，直达对应技能（跳过正则与解释类仲裁）。
   *  合法性由 shared ConsultSkillIdSchema 在 HTTP 边界校验（未知值 400），此处只做形状分发。 */
  skillId?: string | null
}

/**
 * 注册表行：声明式元数据（触发 / 执行器 / 守门与溯源 / 降级），docs/10 §5 的代码化。
 * 行顺序 = 路由优先级（S0 → S2 → S1；S3 从属 S1 内部，不参与 routeSkill 返回）。
 */
export interface SkillRow {
  id: SkillId
  label: string
  /** 触发条件描述（判定本体：S0 = patterns.ts 正则，S2 = intent.ts 正则，S1 内部 = guards.ts 全量决策）。 */
  trigger: string
  /** 执行器（S0/S1 同走 runConsult：留痕单点；S2 = runDataQuery）。 */
  executor: 'runConsult' | 'runDataQuery' | 'runConsult 内部（no-source 分支）'
  /** 降级路径。 */
  degrade: string
}

export const SKILL_REGISTRY: readonly SkillRow[] = [
  {
    id: 'S0',
    label: '红线守门（L4 紧急 / L3 拒答）',
    trigger: 'EMERGENCY_PATTERN / PROHIBITED_PATTERN 命中（先命中先返回，优先于一切技能）',
    executor: 'runConsult',
    degrade: '—（固定文案，无外部依赖）',
  },
  {
    id: 'S2',
    label: '数据直答（只读工具）',
    trigger: '开关开 + 无守门命中 + classifyConsultIntent 命中（解释类词仲裁：EXPLAIN_INTENT_PATTERN）',
    executor: 'runDataQuery',
    degrade: '无降级：DB 异常显式 500（失败可见不静默，不降级 LLM）',
  },
  {
    id: 'S1',
    label: '说明书问答（manual-gate 为内部门禁）',
    trigger: 'S0/S2 未接手的一切提问（兜底技能）',
    executor: 'runConsult',
    degrade: 'Baichuan 不可用 → fallbackSectionsFromInsert 说明书规则拼装（200 + notice）',
  },
  {
    id: 'S3',
    label: '搜索兜底（从属 S1 no-source 分支）',
    trigger: 'S1 内部 detectNoSource(drugs) 且 ENABLE_MEDICAL_SEARCH=true（默认关）',
    executor: 'runConsult 内部（no-source 分支）',
    degrade: '搜索失败 → no-source 固定文案；必标「基于网络检索，未经本库核实」',
  },
]

/**
 * 技能路由（纯函数，零 I/O、确定性）：按优先级短路判定。
 * 顺序 = specs/04-T7 的完整分发契约：
 *   1. S0：detectEmergency → detectProhibited（**守门优先于一切，含快路径**——混合句
 *      「我胸痛」即使带 skillId 也必须走 L4）；
 *   2. skillId 快路径：s1-insert → S1；s2-<intent> → S2/<intent>（不受 intentRouteEnabled
 *      影响——开关管的是「从自由文本猜意图」，快路径是客户端显式指定）；
 *   3. S2 正则：开关开 + classifyConsultIntent 命中（宁漏勿误：漏判 = 走 S1 = 行为与无路由一致）；
 *   4. S1：兜底（manual-gate / no-source / proceed 由 runConsult 内部 guardConsult 全量决策）。
 */
export function routeSkill(input: SkillRouteInput): SkillRouteDecision {
  // 1. S0 红线：守门优先于意图路由与快路径（混合句用例见 consult-registry.test.ts）
  const emergency = detectEmergency(input.question)
  if (emergency) return { skill: 'S0', kind: 'emergency', matched: emergency }
  const prohibited = detectProhibited(input.question)
  if (prohibited) return { skill: 'S0', kind: 'refused', matched: prohibited }

  // 2. skillId 快路径（M4-T7）：跳过正则与解释类仲裁
  if (input.skillId) {
    if (input.skillId === 's1-insert') return { skill: 'S1' }
    const intent = input.skillId.replace(/^s2-/, '') as QueryIntent
    return { skill: 'S2', intent }
  }

  // 3. S2 数据直答：开关开 + 正则命中（解释类词仲裁在 classifyConsultIntent 内）
  if (input.intentRouteEnabled) {
    const intent = classifyConsultIntent(input.question)
    if (intent) return { skill: 'S2', intent }
  }

  // 4. S1 说明书问答（兜底）
  return { skill: 'S1' }
}
