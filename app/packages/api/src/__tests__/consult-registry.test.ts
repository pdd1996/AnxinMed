/**
 * 技能注册表单测（M4-T3 · specs/04-T3）——routeSkill 分支覆盖与既有 service 层 if-else 一一对应。
 *
 * 零行为变更的对照关系（左 = 旧 service 层判定，右 = routeSkill 返回）：
 *   detectEmergency 命中                     → S0/emergency（守门优先，**不做**意图判定）
 *   detectProhibited 命中                    → S0/refused
 *   开关开 + classifyConsultIntent 命中      → S2/<intent>
 *   开关开 + 解释类词仲裁命中（返回 null）    → S1
 *   开关关                                    → S1（即使问题长得像数据查询）
 *   其他一切                                  → S1（兜底）
 *
 * 纯函数测试（零 I/O）；正则变体的全集覆盖在 consult-intent.test.ts / consult-guards.test.ts，
 * 本文件只钉「分发顺序」这一契约。
 */
import { describe, it, expect } from 'vitest'
import { routeSkill, SKILL_REGISTRY } from '../services/consult/registry.js'

describe('routeSkill · S0 红线（守门优先于意图路由）', () => {
  it('混合句「我胸痛，还有多少药」→ S0 emergency（尽管它同时命中 medication-list 正则）', () => {
    // 该句同时满足 medication-list 的 /多少.{0,4}(种)?药/ ——若守门不优先会被数据查询截胡（M3-T1 验收红线）
    const d = routeSkill({ question: '我胸痛，还有多少药', intentRouteEnabled: true })
    expect(d).toEqual({ skill: 'S0', kind: 'emergency', matched: '胸痛' })
  })

  it('混合句「药停了，还有什么药」→ S0 refused（尽管同时命中 medication-list 正则）', () => {
    const d = routeSkill({ question: '药停了，还有什么药', intentRouteEnabled: true })
    expect(d).toEqual({ skill: 'S0', kind: 'refused', matched: '药停了' })
  })

  it('纯守门句（无药上下文语义）→ S0', () => {
    expect(routeSkill({ question: '我呼吸困难', intentRouteEnabled: true })).toEqual({
      skill: 'S0',
      kind: 'emergency',
      matched: '呼吸困难',
    })
    expect(routeSkill({ question: '能不能减量', intentRouteEnabled: true })).toEqual({
      skill: 'S0',
      kind: 'refused',
      matched: '减量',
    })
  })

  it('开关关时守门仍然生效（S0 不受 ENABLE_INTENT_ROUTE 影响）', () => {
    expect(routeSkill({ question: '我胸痛', intentRouteEnabled: false })).toEqual({
      skill: 'S0',
      kind: 'emergency',
      matched: '胸痛',
    })
  })
})

describe('routeSkill · S2 数据直答（4 意图一一对应）', () => {
  const CASES: Array<{ q: string; intent: string }> = [
    { q: '我现在有多少药物？', intent: 'medication-list' },
    { q: '我的依从性怎么样？', intent: 'adherence' },
    { q: '有什么药快过期或快用完了？', intent: 'expiry-stock' },
    { q: '我的药一起吃有冲突吗？', intent: 'interaction-check' },
  ]
  for (const { q, intent } of CASES) {
    it(`「${q}」→ S2/${intent}`, () => {
      expect(routeSkill({ question: q, intentRouteEnabled: true })).toEqual({ skill: 'S2', intent })
    })
  }

  it('开关关（ENABLE_INTENT_ROUTE=false 显式关闭）→ S1（旧行为整体回滚语义）', () => {
    expect(routeSkill({ question: '我现在有多少药物？', intentRouteEnabled: false })).toEqual({ skill: 'S1' })
  })
})

describe('routeSkill · S1 说明书问答（兜底）', () => {
  it('解释类词仲裁：数据问句含说明书词汇 → S1（宁漏勿误，classifyConsultIntent 返回 null）', () => {
    // 「我的药有哪些副作用」含「副作用」→ EXPLAIN_INTENT_PATTERN 仲裁 → 不进 S2
    expect(routeSkill({ question: '我的药有哪些副作用', intentRouteEnabled: true })).toEqual({ skill: 'S1' })
  })

  it('说明书类问题 → S1', () => {
    expect(routeSkill({ question: '这个药通常用于什么？', intentRouteEnabled: true })).toEqual({ skill: 'S1' })
    expect(routeSkill({ question: '常见不良反应有哪些？', intentRouteEnabled: true })).toEqual({ skill: 'S1' })
  })

  it('空串 / 任意自由文本 → S1', () => {
    expect(routeSkill({ question: '', intentRouteEnabled: true })).toEqual({ skill: 'S1' })
    expect(routeSkill({ question: '今天天气怎么样', intentRouteEnabled: true })).toEqual({ skill: 'S1' })
  })
})

describe('SKILL_REGISTRY 注册表声明', () => {
  it('四行齐备，行顺序 = 路由优先级（S0 → S2 → S1 → S3 从属声明）', () => {
    expect(SKILL_REGISTRY.map((r) => r.id)).toEqual(['S0', 'S2', 'S1', 'S3'])
  })

  it('S3 不参与 routeSkill 返回值（从属 S1 内部 no-source 分支，判定留在 run.ts）', () => {
    // no-source 的判定需要 drugs 上下文（detectNoSource）与 ENABLE_MEDICAL_SEARCH，
    // 属 runConsult 内部决策——routeSkill 入参无 drugs，结构上不可能返回 S3
    const d = routeSkill({ question: '这个药通常用于什么？', intentRouteEnabled: true })
    expect(d.skill).not.toBe('S3')
  })

  it('执行器声明与实现一致：S2 → runDataQuery，S0/S1 → runConsult，S3 → runConsult 内部', () => {
    const byId = new Map(SKILL_REGISTRY.map((r) => [r.id, r]))
    expect(byId.get('S0')?.executor).toBe('runConsult')
    expect(byId.get('S1')?.executor).toBe('runConsult')
    expect(byId.get('S2')?.executor).toBe('runDataQuery')
    expect(byId.get('S3')?.executor).toBe('runConsult 内部（no-source 分支）')
  })
})
