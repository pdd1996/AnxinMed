/**
 * M2-T5 · checkInteractions 单测（相互作用规则引擎，PRD §7.8.2 / §8.2）。
 * 覆盖：生效集合命中、规则药不全在集合→不命中+未覆盖提示、四级分级排序、单药无组合、
 *       空规则库、药名缺失回退 id、三药规则全在才命中、去重/空值过滤。
 */
import { describe, it, expect } from 'vitest'
import {
  checkInteractions,
  INTERACTION_COVERAGE_NOTE,
  type InteractionRuleInput,
} from '../services/rules/index.js'

const RULE_AB: InteractionRuleInput = { id: 'ir-001', drugIds: ['dm-a', 'dm-b'], level: '需监测', note: 'A 与 B 联用需监测', source: '两药说明书相互作用段', status: 'demo' }
const RULE_BC: InteractionRuleInput = { id: 'ir-002', drugIds: ['dm-b', 'dm-c'], level: '禁忌', note: 'B 与 C 禁忌联用', source: '药监局修订公告', status: 'curated' }
const RULE_ABC: InteractionRuleInput = { id: 'ir-003', drugIds: ['dm-a', 'dm-b', 'dm-c'], level: '慎用', note: 'A/B/C 三药慎用', source: '权威指南', status: 'curated' }
const NAMES: Record<string, string> = { 'dm-a': '药A', 'dm-b': '药B', 'dm-c': '药C' }

describe('checkInteractions · 相互作用（生效计划集合）', () => {
  it('规则的每个药都在生效集合 → 命中，带 level/note/source/drugNames，无未覆盖提示', () => {
    const r = checkInteractions(['dm-a', 'dm-b'], [RULE_AB], NAMES)
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0]).toMatchObject({ level: '需监测', note: 'A 与 B 联用需监测', source: '两药说明书相互作用段' })
    expect(r.hits[0].drugNames).toEqual(['药A', '药B'])
    expect(r.coverageNote).toBeNull()
  })

  it('规则有药不在生效集合 → 不命中；集合≥2 药时给出未覆盖提示（未覆盖≠无风险）', () => {
    const r = checkInteractions(['dm-a', 'dm-c'], [RULE_AB], NAMES) // 缺 dm-b
    expect(r.hits).toEqual([])
    expect(r.coverageNote).toBe(INTERACTION_COVERAGE_NOTE)
  })

  it('多规则命中 → 按四级分级降序（禁忌 > 需监测）', () => {
    const r = checkInteractions(['dm-a', 'dm-b', 'dm-c'], [RULE_AB, RULE_BC], NAMES)
    expect(r.hits.map((h) => h.level)).toEqual(['禁忌', '需监测'])
    expect(r.coverageNote).toBeNull()
  })

  it('单药（集合<2）→ 无组合可检，hits 空且不给未覆盖提示（避免误导）', () => {
    const r = checkInteractions(['dm-a'], [RULE_AB, RULE_BC], NAMES)
    expect(r.hits).toEqual([])
    expect(r.coverageNote).toBeNull()
  })

  it('空规则库 + 两药 → hits 空 + 未覆盖提示', () => {
    const r = checkInteractions(['dm-a', 'dm-b'], [], NAMES)
    expect(r.hits).toEqual([])
    expect(r.coverageNote).toBe(INTERACTION_COVERAGE_NOTE)
  })

  it('药名映射缺失 → drugNames 回退为 drug_master.id（不编造名称）', () => {
    const r = checkInteractions(['dm-a', 'dm-b'], [RULE_AB], {})
    expect(r.hits[0].drugNames).toEqual(['dm-a', 'dm-b'])
  })

  it('三药规则：仅 2 药在集合不命中；3 药全在才命中', () => {
    expect(checkInteractions(['dm-a', 'dm-b'], [RULE_ABC], NAMES).hits).toEqual([])
    const full = checkInteractions(['dm-a', 'dm-b', 'dm-c'], [RULE_ABC], NAMES)
    expect(full.hits).toHaveLength(1)
    expect(full.hits[0].drugIds).toEqual(['dm-a', 'dm-b', 'dm-c'])
  })

  it('生效集合去重 + 过滤空值后仍正确匹配', () => {
    const r = checkInteractions(['dm-a', 'dm-a', '', 'dm-b'], [RULE_AB], NAMES)
    expect(r.hits).toHaveLength(1)
  })

  it('M8：命中透传 status（demo 供 UI 标注）；retired 规则不参与匹配', () => {
    const demoHit = checkInteractions(['dm-a', 'dm-b'], [RULE_AB], NAMES)
    expect(demoHit.hits[0].status).toBe('demo')
    const curatedHit = checkInteractions(['dm-b', 'dm-c'], [RULE_BC], NAMES)
    expect(curatedHit.hits[0].status).toBe('curated')

    const retired: InteractionRuleInput = { ...RULE_AB, status: 'retired' }
    const r = checkInteractions(['dm-a', 'dm-b'], [retired], NAMES)
    expect(r.hits).toEqual([])
    expect(r.coverageNote).toBe(INTERACTION_COVERAGE_NOTE)
  })

  it('M10 概念组：每组任一生效即命中，hit.drugIds 是实际命中的具体 ID', () => {
    const rule: InteractionRuleInput = {
      id: 'ir-group',
      drugIds: ['sim-a', 'sim-b', 'clar-a', 'clar-b'],
      drugGroups: [
        ['sim-a', 'sim-b'],
        ['clar-a', 'clar-b'],
      ],
      level: '禁忌',
      note: '辛伐他汀与克拉霉素禁止合用（测试）',
      source: '测试规则库',
      status: 'curated',
    }
    const names = { 'sim-a': '辛伐他汀片A', 'sim-b': '辛伐他汀片B', 'clar-a': '克拉霉素片A', 'clar-b': '克拉霉素片B' }
    const hit = checkInteractions(['sim-b', 'clar-a'], [rule], names)
    expect(hit.hits).toHaveLength(1)
    expect(hit.hits[0].drugIds).toEqual(['sim-b', 'clar-a'])
    expect(hit.hits[0].drugNames).toEqual(['辛伐他汀片B', '克拉霉素片A'])

    // 只有一组命中 → 不触发；旧 flat 语义不会误触发
    expect(checkInteractions(['sim-b'], [rule], names).hits).toEqual([])
    expect(checkInteractions(['sim-b', 'clar-c'], [rule], names).hits).toEqual([])
  })

  it('M10 概念组 retired 不参与匹配', () => {
    const rule: InteractionRuleInput = {
      id: 'ir-group-retired',
      drugIds: ['sim-a', 'clar-a'],
      drugGroups: [['sim-a'], ['clar-a']],
      level: '禁忌',
      note: 'x',
      source: 'x',
      status: 'retired',
    }
    expect(checkInteractions(['sim-a', 'clar-a'], [rule], {}).hits).toEqual([])
  })
})
