/**
 * M3-T1 · 咨询守门纯函数单测（PRD §7.5.1–§7.5.4）。
 *
 * 覆盖：
 * - detectEmergency × 4（L4 各口语变体：胸痛/呼吸困难/儿童误服/自杀）
 * - detectProhibited × 4（L3 停药/换药/剂量调整变体）
 * - detectManualGate × 2（全 manual → true；混选 → false）
 * - detectNoSource × 2（全 null insert → true；有 insert → false）
 * - guardConsult 优先级 × 2（L4 > L3；L3 > manual-gate）
 * - 不误伤 × 1（"这个药通常用于什么" → proceed）
 *
 * = 15 case（超过 spec 要求的 ≥12）。
 */
import { describe, it, expect } from 'vitest'
import {
  detectEmergency,
  detectManualGate,
  detectNoSource,
  detectProhibited,
  guardConsult,
} from '../services/consult/guards.js'
import type { ConsultDrug, InsertSlice } from '../services/consult/types.js'

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

const mkInsert = (overrides: Partial<InsertSlice> = {}): InsertSlice => ({
  drugId: 'dm-test',
  genericName: '测试药',
  brandName: null,
  specification: null,
  form: null,
  indication: null,
  components: null,
  dosage: null,
  contraindications: null,
  adverseReactions: null,
  precautions: null,
  interactions: null,
  pharmacology: null,
  pharmacokinetics: null,
  storage: null,
  source: '测试来源',
  version: 'v1',
  ...overrides,
})

const mkDrug = (overrides: Partial<ConsultDrug> = {}): ConsultDrug => ({
  id: 'drug-test',
  drugMasterId: 'dm-test',
  genericName: '测试药',
  brandName: null,
  confirmStatus: 'transcribed',
  insert: mkInsert(),
  ...overrides,
})

// ---------------------------------------------------------------------------
// L4 紧急信号
// ---------------------------------------------------------------------------

describe('detectEmergency · L4 紧急信号（PRD §7.5.1）', () => {
  it('"我胸痛" → 命中「胸痛」', () => {
    expect(detectEmergency('我胸痛得厉害')).toBe('胸痛')
  })

  it('"呼吸困难" → 命中', () => {
    expect(detectEmergency('突然呼吸困难')).toBe('呼吸困难')
  })

  it('"儿童误服了降压药" → 命中「儿童误服」', () => {
    expect(detectEmergency('家里儿童误服了降压药怎么办')).toBe('儿童误服')
  })

  it('"我想自杀" → 命中「自杀」', () => {
    expect(detectEmergency('我想自杀')).toBe('自杀')
  })

  it('正常咨询 "这个药通常用于什么" → 不命中（返回 null）', () => {
    expect(detectEmergency('这个药通常用于什么')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// L3 拒答
// ---------------------------------------------------------------------------

describe('detectProhibited · L3 拒答（PRD §7.5.2）', () => {
  it('"能不能停药" → 命中「能停」', () => {
    expect(detectProhibited('能不能停药')).toBe('能停')
  })

  it('"把这个药停了" → 命中「把这个药停」', () => {
    expect(detectProhibited('把这个药停了行不行')).toBe('把这个药停')
  })

  it('"应该吃几片" → 命中（剂量调整类）', () => {
    expect(detectProhibited('我应该吃几片')).toBe('应该吃几片')
  })

  it('"换成别的药" → 命中「能换」（正则顺序：能换在换成前）', () => {
    expect(detectProhibited('能不能换成别的药')).toBe('能换')
  })

  it('正常咨询 "这个药的不良反应有哪些" → 不命中', () => {
    expect(detectProhibited('这个药的不良反应有哪些')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// manual 档门禁
// ---------------------------------------------------------------------------

describe('detectManualGate · manual 档门禁（PRD §7.5.4）', () => {
  it('全为 manual 档 → true', () => {
    const drugs = [
      mkDrug({ id: 'd1', confirmStatus: 'manual', drugMasterId: null, insert: null }),
      mkDrug({ id: 'd2', confirmStatus: 'manual', drugMasterId: null, insert: null }),
    ]
    expect(detectManualGate(drugs)).toBe(true)
  })

  it('混选（manual + transcribed）→ false（保守策略，避免误伤）', () => {
    const drugs = [
      mkDrug({ id: 'd1', confirmStatus: 'manual', drugMasterId: null, insert: null }),
      mkDrug({ id: 'd2', confirmStatus: 'transcribed' }),
    ]
    expect(detectManualGate(drugs)).toBe(false)
  })

  it('空数组 → false（无药上下文不走 manual-gate）', () => {
    expect(detectManualGate([])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// no-source（本地未命中）
// ---------------------------------------------------------------------------

describe('detectNoSource · 本地说明书库未命中', () => {
  it('所有药 insert=null → true', () => {
    const drugs = [
      mkDrug({ id: 'd1', insert: null }),
      mkDrug({ id: 'd2', insert: null }),
    ]
    expect(detectNoSource(drugs)).toBe(true)
  })

  it('至少一个药有 insert → false', () => {
    const drugs = [mkDrug({ id: 'd1', insert: null }), mkDrug({ id: 'd2' })]
    expect(detectNoSource(drugs)).toBe(false)
  })

  it('空数组 → false（无药上下文不走 no-source）', () => {
    expect(detectNoSource([])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// guardConsult 编排（优先级）
// ---------------------------------------------------------------------------

describe('guardConsult · 守门编排优先级', () => {
  it('L4 优先于 L3：问题同时含"胸痛"和"停药" → emergency', () => {
    const d = guardConsult('我胸痛，能不能停药', [mkDrug()])
    expect(d).toEqual({ kind: 'emergency', matched: '胸痛' })
  })

  it('L3 优先于 manual-gate：manual 档药 + "能不能停药" → refused', () => {
    const drugs = [mkDrug({ confirmStatus: 'manual', drugMasterId: null, insert: null })]
    const d = guardConsult('能不能停药', drugs)
    expect(d).toEqual({ kind: 'refused', matched: '能停' })
  })

  it('manual-gate 优先于 no-source：manual 档 + insert=null → manual-gate', () => {
    const drugs = [mkDrug({ confirmStatus: 'manual', drugMasterId: null, insert: null })]
    const d = guardConsult('这个药通常用于什么', drugs)
    expect(d).toEqual({ kind: 'manual-gate' })
  })

  it('无药上下文 + L4 问题 → emergency（drugIds 空也能触发）', () => {
    const d = guardConsult('我胸痛', [])
    expect(d).toEqual({ kind: 'emergency', matched: '胸痛' })
  })

  it('无药上下文 + 正常问题 → proceed（不触发 manual-gate/no-source）', () => {
    const d = guardConsult('这个药通常用于什么', [])
    expect(d).toEqual({ kind: 'proceed' })
  })

  it('正常咨询 + 有 insert → proceed', () => {
    const d = guardConsult('这个药通常用于什么', [mkDrug()])
    expect(d).toEqual({ kind: 'proceed' })
  })
})
