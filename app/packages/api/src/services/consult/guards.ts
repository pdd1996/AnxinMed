/**
 * 咨询守门（M3-T1 · PRD §7.5.1–§7.5.4）——纯函数，零 I/O，确定性。
 *
 * 优先级（先命中先返回）：
 *   1. L4 emergency   紧急信号（胸痛/急救词）→ 停止常规流程，引导急救，触发留痕
 *   2. L3 refused     停药/换药/剂量调整 → 拒答 + 引导开方医生，触发留痕
 *   3. manual-gate    manual 档药品拒绝个体化解释（仅可 L0 资料查询）
 *   4. no-source      本地说明书库未命中（且医疗搜索默认关）
 *   5. proceed        进入生成路径（Baichuan 或降级规则拼装）
 *
 * ⚠️ L4 与 L3 触发时必须写 risk_events 留痕（run.ts 编排），供 M3-T3 医生端洞察消费。
 */
import { EMERGENCY_PATTERN, PROHIBITED_PATTERN } from './patterns.js'
import type { ConsultDrug, GuardDecision } from './types.js'

/**
 * L4 紧急信号检测：返回命中关键词（供 risk_events.detail 留痕），未命中返回 null。
 * 使用 `match` 而非 `test` 以取到具体命中词——医生端聚合需要知道触发了哪个信号。
 */
export function detectEmergency(question: string): string | null {
  const m = String(question ?? '').match(EMERGENCY_PATTERN)
  return m ? m[0] : null
}

/**
 * L3 拒答检测：返回命中关键词，未命中返回 null。
 * 覆盖停药/换药/剂量调整的口语变体；不得误伤正常咨询词（如"这个药通常用于什么"）。
 */
export function detectProhibited(question: string): string | null {
  const m = String(question ?? '').match(PROHIBITED_PATTERN)
  return m ? m[0] : null
}

/**
 * manual 档门禁：药品为用户手动建档（未经 OCR 确认）→ 拒绝进入个体化用药解释。
 * 仅当**所有**咨询对象均为 manual 档时触发（如混选则允许，manual 药仅做 L0 资料查询由前端提示）。
 *
 * 注：demo 单药场景下等价于 `drug.confirmStatus === 'manual'`；
 * 多药场景（spec §T1.6 drugIds[]）取保守策略——全为 manual 才拒绝，避免误伤混选。
 */
export function detectManualGate(drugs: ConsultDrug[]): boolean {
  if (drugs.length === 0) return false
  return drugs.every((d) => d.confirmStatus === 'manual')
}

/** 本地说明书库未命中：所有咨询对象都查不到 insert（且医疗搜索默认关时触发 no-source）。 */
export function detectNoSource(drugs: ConsultDrug[]): boolean {
  if (drugs.length === 0) return false
  return drugs.every((d) => d.insert === null)
}

/**
 * 守门编排（纯函数）：按优先级返回决策。
 * @param question 用户提问（已过 L3 出口脱敏）
 * @param drugs    咨询对象（可空——L4/L3 可在无药上下文时触发）
 */
export function guardConsult(question: string, drugs: ConsultDrug[]): GuardDecision {
  const emergency = detectEmergency(question)
  if (emergency) return { kind: 'emergency', matched: emergency }

  const prohibited = detectProhibited(question)
  if (prohibited) return { kind: 'refused', matched: prohibited }

  // 有药上下文才走 manual-gate / no-source（无药时 L4/L3 已覆盖紧急与拒答路径）
  if (drugs.length > 0) {
    if (detectManualGate(drugs)) return { kind: 'manual-gate' }
    if (detectNoSource(drugs)) return { kind: 'no-source' }
  }

  return { kind: 'proceed' }
}
