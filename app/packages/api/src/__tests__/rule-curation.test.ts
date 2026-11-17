/**
 * M8-T1 · 规则库正式化守门单测。
 *
 * 覆盖 PRD §7.8.1 的「只许抄录」约束：note ⊆ quote ⊆ 所引说明书段；demo 必须自报演示；
 * curated 必须带来源类型/引用/签名；药品存在性、药对去重、retired 不参与匹配。
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeQuoteText,
  summarizeRules,
  validateRule,
  validateRules,
  type RuleCurationContext,
  type RuleCurationInput,
} from '../services/rules/rule-curation.js'

const SECTION_TEXT =
  '合用氨氯地平不改变阿托伐他汀、地高辛、乙醇（酒精）的暴露量，和华法林的凝血酶原反应时间。' +
  '辛伐他汀：多剂量 10 mg 氨氯地平与 80 mg 辛伐他汀合用时，辛伐他汀的暴露量比单独使用辛伐他汀增加了 77%。'

function ctx(overrides: Partial<RuleCurationContext> = {}): RuleCurationContext {
  return {
    existingDrugMasterIds: ['dm-a', 'dm-b', 'dm-c'],
    manualsByInsertId: {
      'pi-a': {
        insertId: 'pi-a',
        drugId: 'dm-a',
        curationStatus: 'reviewed',
        sections: { 药物相互作用: SECTION_TEXT },
      },
    },
    ...overrides,
  }
}

function curated(overrides: Partial<RuleCurationInput> = {}): RuleCurationInput {
  return {
    id: 'ir-curated-1',
    drugIds: ['dm-a', 'dm-b'],
    level: '需监测',
    note: '辛伐他汀的暴露量比单独使用辛伐他汀增加了 77%',
    source: '氨氯地平说明书·药物相互作用（逐字抄录）',
    status: 'curated',
    sourceType: 'manual-interaction',
    sourceRef: JSON.stringify({ insertId: 'pi-a', drugId: 'dm-a', sectionKey: '药物相互作用' }),
    quote: '多剂量 10 mg 氨氯地平与 80 mg 辛伐他汀合用时，辛伐他汀的暴露量比单独使用辛伐他汀增加了 77%。',
    reviewedBy: '测试核对人',
    ...overrides,
  }
}

describe('rule-curation · 守门', () => {
  it('demo 条目（source 含「演示」）放行', () => {
    const r = validateRule(
      {
        id: 'ir-001',
        drugIds: ['dm-a', 'dm-b'],
        level: '需监测',
        note: '演示说明',
        source: '两药说明书相互作用段（演示抄录）',
        status: 'demo',
      },
      ctx(),
    )
    expect(r.errors).toEqual([])
  })

  it('demo 条目 source 不含「演示」→ 拒绝（禁止冒充正式）', () => {
    const r = validateRule(
      {
        id: 'ir-x',
        drugIds: ['dm-a', 'dm-b'],
        level: '需监测',
        note: 'x',
        source: '两药说明书相互作用段',
        status: 'demo',
      },
      ctx(),
    )
    expect(r.errors.some((e) => e.includes('必须含「演示」'))).toBe(true)
  })

  it('curated 合法：note ⊆ quote ⊆ 原段', () => {
    expect(validateRule(curated(), ctx()).errors).toEqual([])
  })

  it('note 不是 quote 的逐字子串 → 拒绝', () => {
    const r = validateRule(curated({ note: '氨氯地平与辛伐他汀联用可增加肌病风险' }), ctx())
    expect(r.errors.some((e) => e.includes('note 不是 quote 的逐字子串'))).toBe(true)
  })

  it('quote 不是原段的逐字子串（改写）→ 拒绝', () => {
    const r = validateRule(curated({ quote: '氨氯地平让辛伐他汀浓度升高 77%' }), ctx())
    expect(r.errors.some((e) => e.includes('quote 不是所引说明书段的逐字子串'))).toBe(true)
  })

  it('空白/换行差异不算改写（规范化后仍逐字）', () => {
    const r = validateRule(
      curated({
        quote: '多剂量 10 mg 氨氯地平与\n80 mg 辛伐他汀合用时，辛伐他汀的暴露量比单独使用辛伐他汀增加了 77%。',
      }),
      ctx(),
    )
    expect(r.errors).toEqual([])
    expect(normalizeQuoteText('A\n B')).toBe('AB')
  })

  it('sectionKey 不是 PRD 允许的相互作用段 → 拒绝（禁止用注意事项段顶替）', () => {
    const r = validateRule(
      curated({
        sourceRef: JSON.stringify({ insertId: 'pi-a', drugId: 'dm-a', sectionKey: '注意事项' }),
      }),
      ctx({
        manualsByInsertId: {
          'pi-a': {
            insertId: 'pi-a',
            drugId: 'dm-a',
            curationStatus: 'reviewed',
            sections: { 注意事项: SECTION_TEXT },
          },
        },
      }),
    )
    expect(r.errors.some((e) => e.includes('不是 PRD §7.8.1 允许的相互作用段'))).toBe(true)
  })

  it('所引说明书行未 reviewed → 拒绝', () => {
    const c = ctx({
      manualsByInsertId: {
        'pi-a': {
          insertId: 'pi-a',
          drugId: 'dm-a',
          curationStatus: 'crawled',
          sections: { 药物相互作用: SECTION_TEXT },
        },
      },
    })
    expect(validateRule(curated(), c).errors.some((e) => e.includes('未 reviewed'))).toBe(true)
  })

  it('curated 缺 source_type/quote/source_ref/reviewed_by → 逐项报错', () => {
    const r = validateRule(
      curated({ sourceType: null, quote: null, sourceRef: null, reviewedBy: null }),
      ctx(),
    )
    expect(r.errors.some((e) => e.includes('必须填 source_type'))).toBe(true)
    expect(r.errors.some((e) => e.includes('必须填 quote'))).toBe(true)
    expect(r.errors.some((e) => e.includes('必须填 source_ref'))).toBe(true)
    expect(r.errors.some((e) => e.includes('必须填 reviewed_by'))).toBe(true)
  })

  it('sourceRef JSON 非法 / insertId 不存在 → 拒绝', () => {
    const badJson = validateRule(curated({ sourceRef: 'not-json' }), ctx())
    expect(badJson.errors.some((e) => e.includes('必须是合法 JSON'))).toBe(true)

    const missing = validateRule(
      curated({ sourceRef: JSON.stringify({ insertId: 'pi-x', drugId: 'dm-a', sectionKey: '药物相互作用' }) }),
      ctx(),
    )
    expect(missing.errors.some((e) => e.includes('在库中不存在'))).toBe(true)
  })

  it('sourceRef.drugId 与说明书行不一致 / 不在 drugIds → 拒绝', () => {
    const wrongDrugId = validateRule(
      curated({ sourceRef: JSON.stringify({ insertId: 'pi-a', drugId: 'dm-c', sectionKey: '药物相互作用' }) }),
      ctx(),
    )
    expect(wrongDrugId.errors.some((e) => e.includes('与说明书行实际 drugId'))).toBe(true)
  })

  it('drug_master 不存在的 ID / 批内重复 ID → 拒绝', () => {
    expect(validateRule(curated({ drugIds: ['dm-a', 'dm-unknown'] }), ctx()).errors.some((e) => e.includes('drug_master 不存在'))).toBe(true)
    expect(validateRule(curated({ drugIds: ['dm-a', 'dm-a'] }), ctx()).errors.some((e) => e.includes('含重复药品'))).toBe(true)
  })

  it('同药对重复：批内 / 与库内已有 → 拒绝', () => {
    const one = curated({ id: 'r1' })
    const two = curated({ id: 'r2', level: '注意', note: '辛伐他汀的暴露量比单独使用辛伐他汀增加了 77%' })
    expect(validateRules([one, two], ctx()).errors.some((e) => e.includes('同一药品组合出现多条规则'))).toBe(true)

    const existing = ctx({ existingRules: [{ id: 'r-old', drugIds: ['dm-b', 'dm-a'], status: 'curated' }] })
    expect(validateRules([one], existing).errors.some((e) => e.includes('同一药品组合'))).toBe(true)
  })

  it('retired 条目只告警、不做逐字校验', () => {
    const r = validateRule(
      { id: 'ir-old', drugIds: ['dm-a', 'dm-b'], level: '注意', note: '旧规则', source: '旧来源', status: 'retired' },
      ctx(),
    )
    expect(r.errors).toEqual([])
    expect(r.warnings.some((w) => w.includes('retired'))).toBe(true)
  })

  it('nmpa/指南来源：URL 不合法 → 拒绝；合法 → 告警无法机器校验', () => {
    const bad = validateRule(
      curated({ sourceType: 'guideline', sourceRef: '说明书第 3 页' }),
      ctx(),
    )
    expect(bad.errors.some((e) => e.includes('需要是可访问的 URL'))).toBe(true)

    const ok = validateRule(
      curated({ sourceType: 'guideline', sourceRef: 'https://example.org/guideline/1' }),
      ctx(),
    )
    expect(ok.errors).toEqual([])
    expect(ok.warnings.some((w) => w.includes('无法机器逐字校验'))).toBe(true)
  })

  it('summarizeRules 按状态计数', () => {
    expect(summarizeRules([curated(), curated({ id: 'r2', drugIds: ['dm-a', 'dm-c'] })])).toEqual({
      demo: 0,
      curated: 2,
      retired: 0,
    })
  })

  it('M10 概念组：合法组通过；drugIds 必须等于展开并集', () => {
    const grouped = curated({
      drugIds: ['dm-a', 'dm-b', 'dm-c'],
      drugGroups: [
        ['dm-a', 'dm-b'],
        ['dm-c'],
      ],
      quote: SECTION_TEXT,
      note: '辛伐他汀的暴露量比单独使用辛伐他汀增加了 77%',
    })
    // sourceRef 指向 dm-a 的说明书行；drugGroups 包含 dm-a → 通过
    expect(validateRule(grouped, ctx()).errors).toEqual([])

    const mismatched = curated({ drugIds: ['dm-a', 'dm-b'], drugGroups: [['dm-a'], ['dm-b'], ['dm-c']] })
    expect(validateRule(mismatched, ctx()).errors.some((e) => e.includes('展开不一致'))).toBe(true)
  })

  it('M10 概念组：空组/跨组重复/未知 ID/少于 2 组 → 报错', () => {
    const oneGroup = curated({ drugGroups: [['dm-a', 'dm-b']] })
    expect(validateRule(oneGroup, ctx()).errors.some((e) => e.includes('至少 2 组'))).toBe(true)

    const emptyGroup = curated({ drugIds: ['dm-a', 'dm-b'], drugGroups: [['dm-a'], []] })
    expect(validateRule(emptyGroup, ctx()).errors.some((e) => e.includes('为空组'))).toBe(true)

    const crossDup = curated({ drugIds: ['dm-a', 'dm-b'], drugGroups: [['dm-a', 'dm-b'], ['dm-b', 'dm-c']] })
    expect(validateRule(crossDup, ctx()).errors.some((e) => e.includes('多个概念组'))).toBe(true)

    const unknown = curated({ drugIds: ['dm-a', 'dm-x'], drugGroups: [['dm-a'], ['dm-x']] })
    expect(validateRule(unknown, ctx()).errors.some((e) => e.includes('不存在的药品'))).toBe(true)
  })

  it('M10 概念组药对去重：组顺序不同视为同一药对', () => {
    const a = curated({ id: 'g1', drugIds: ['dm-a', 'dm-b'], drugGroups: [['dm-a'], ['dm-b']] })
    const b = curated({ id: 'g2', drugIds: ['dm-b', 'dm-a'], drugGroups: [['dm-b'], ['dm-a']] })
    expect(validateRules([a, b], ctx()).errors.some((e) => e.includes('同一药品组合'))).toBe(true)
  })
})
